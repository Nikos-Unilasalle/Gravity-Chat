use serde::{Deserialize, Serialize};
use reqwest::Client;
use std::sync::{Arc, Mutex as StdMutex};
use tokio::sync::Mutex;
use tauri::{State, Emitter, Window};
use std::io::BufRead;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Message {
    pub role: String,
    pub content: String,
    pub images: Option<Vec<String>>,
}


#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ChatChunk {
    pub message: Option<Message>,
    pub done: bool,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Model {
    pub name: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ModelsResponse {
    pub models: Vec<Model>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct FileData {
    pub name: String,
    pub path: String,
    pub content_type: String,
    pub data: String,
}

pub struct AppState {
    pub client: Client,
    pub ollama_url: Mutex<String>,
    pub abort_flag: Arc<StdMutex<bool>>,
}

#[tauri::command]
async fn get_models(state: State<'_, AppState>, api_key: Option<String>, window: Window) -> Result<Vec<String>, String> {
    let mut all_models = Vec::new();
    let ollama_url = state.ollama_url.lock().await.clone();

    if let Ok(resp) = state.client.get(format!("{}/api/tags", ollama_url)).send().await {
        if let Ok(tags) = resp.json::<ModelsResponse>().await {
            for m in tags.models { all_models.push(m.name); }
        }
    }

    if let Some(key) = api_key {
        if !key.is_empty() {
            window.emit("api-log", "Tentative Cloud (Ollama) avec clé...").ok();
            if let Ok(resp) = state.client.get("https://ollama.com/api/tags")
                .header("Authorization", format!("Bearer {}", key))
                .send().await {
                if resp.status().is_success() {
                    if let Ok(tags) = resp.json::<ModelsResponse>().await {
                        for m in &tags.models {
                            all_models.push(format!("{}-cloud", m.name));
                        }
                        window.emit("api-log", format!("{} modèles Ollama Cloud chargés", tags.models.len())).ok();
                    }
                }
            }
        }
    }
    Ok(all_models)
}

#[tauri::command]
async fn chat_stream(
    window: tauri::Window,
    state: State<'_, AppState>,
    model: String,
    messages: Vec<Message>,
    system_prompt: Option<String>,
    api_key: Option<String>,
    think: Option<bool>,
    _is_openai: Option<bool>,
) -> Result<(), String> {
    window.emit("api-log", format!("Chat stream request for model: {}", model)).ok();

    {
        let mut flag = state.abort_flag.lock().unwrap();
        *flag = false;
    }

    let ollama_url = state.ollama_url.lock().await.clone();
    let is_cloud = model.ends_with("-cloud");
    let mut model_name = model.clone();
    
    let base_url = if is_cloud { "https://ollama.com".to_string() } else { ollama_url };
    if is_cloud { model_name = model_name.replace("-cloud", ""); }
    let endpoint = format!("{}/api/chat", base_url);

    let mut conversation = messages.clone();
    if let Some(prompt) = system_prompt {
        if !prompt.is_empty() && !conversation.iter().any(|m| m.role == "system") {
            conversation.insert(0, Message { role: "system".to_string(), content: prompt, images: None });
        }
    }

    {
        if *state.abort_flag.lock().unwrap() { return Ok(()); }

        let request_body = serde_json::json!({
            "model": model_name,
            "messages": conversation,
            "stream": true,
            "think": think.unwrap_or(true),
        });

        let mut request_builder = state.client.post(&endpoint).json(&request_body);
        if let Some(ref key) = api_key {
            if !key.is_empty() {
                request_builder = request_builder.header("Authorization", format!("Bearer {}", key));
            }
        }

        let response = request_builder.send().await.map_err(|e| e.to_string())?;
        use futures_util::StreamExt;
        let mut stream = response.bytes_stream();
        
        while let Some(item) = stream.next().await {
            if *state.abort_flag.lock().unwrap() { break; }
            let chunk = item.map_err(|e| e.to_string())?;
            let reader = std::io::BufReader::new(chunk.as_ref());
            for line in reader.lines() {
                if let Ok(line_str) = line {
                    let trimmed = line_str.trim();
                    if trimmed.is_empty() { continue; }
                    if let Ok(res) = serde_json::from_str::<serde_json::Value>(&line_str) {
                        // Forward the chunk to frontend
                        window.emit("chat-delta", &res).ok();
                    }
                }
            }
        }
    }

    window.emit("api-log", "Stream finished").ok();
    Ok(())
}


#[tauri::command]
async fn stop_chat(state: State<'_, AppState>) -> Result<(), String> {
    let mut flag = state.abort_flag.lock().unwrap();
    *flag = true;
    Ok(())
}

#[tauri::command]
async fn set_ollama_url(state: State<'_, AppState>, url: String) -> Result<(), String> {
    let mut current_url = state.ollama_url.lock().await;
    *current_url = url;
    Ok(())
}

#[tauri::command]
async fn process_file(path: String) -> Result<FileData, String> {
    let content = std::fs::read(&path).map_err(|e| e.to_string())?;
    let name = std::path::Path::new(&path).file_name().unwrap().to_string_lossy().to_string();
    Ok(FileData { name, path, content_type: "text/plain".to_string(), data: String::from_utf8_lossy(&content).to_string() })
}


fn main() {
    #[cfg(target_os = "linux")]
    {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        std::env::set_var("GDK_BACKEND", "x11");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            ollama_url: Mutex::new("http://127.0.0.1:11434".to_string()),
            client: Client::new(),
            abort_flag: Arc::new(StdMutex::new(false)),
        })
        .invoke_handler(tauri::generate_handler![get_models, chat_stream, stop_chat, set_ollama_url, process_file])
        .run(tauri::generate_context!())
        .expect("error");
}

