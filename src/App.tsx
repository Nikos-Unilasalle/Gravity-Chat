import { useState, useEffect, useRef, memo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { 
  Send, Settings, Plus, MessageSquare, Trash2, Cpu, Upload, X, Square, FileText, Image as ImageIcon, Copy, FilePlus, Palette, Folder, FolderPlus, FolderOpen
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { Toaster, toast } from "sonner";
import { motion } from "framer-motion";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import TurndownService from "turndown";
import { marked } from "marked";

const turndownService = new TurndownService();

interface Message {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  images?: string[];
  color?: string; // Add color for text
}

interface Item {
  id: string;
  type: 'chat' | 'note';
  title: string;
  messages: Message[];
  content?: string;
  color?: string; // Sidebar indicator color
  folderId?: string; // For drag and drop grouping
}

interface Folder {
  id: string;
  name: string;
  isOpen: boolean;
}

const MessageItem = memo(({ msg, noThink, onCopy, onToNote, onColorChange, userAvatar, aiAvatar }: { 
  msg: Message, noThink: boolean, onCopy: ()=>void, onToNote: ()=>void, onColorChange: (c:string)=>void, userAvatar: string, aiAvatar: string 
}) => {
  const content = msg.content || "";
  const thinkParts = content.split(/<\/think>/i);
  let thought = "";
  let finalResponse = content;
  let isThinking = false;
  const [showColorPicker, setShowColorPicker] = useState(false);

  if (thinkParts.length > 1) {
    thought = thinkParts[0].replace(/<think>/i, "");
    finalResponse = thinkParts[1];
  } else if (content.includes("<think")) {
    thought = content.replace(/<think>/i, "");
    finalResponse = "";
    isThinking = true;
  }

  const showThought = !noThink && isThinking && thought.trim().length > 0;
  const isUser = msg.role === 'user';
  const customColorStyle = msg.color ? { color: msg.color } : {};

  return (
    <motion.div className={`message-row ${msg.role}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <div className="avatar">
        {isUser ? (userAvatar ? <img src={userAvatar} alt="U" /> : 'U') : (aiAvatar ? <img src={aiAvatar} alt="AI" /> : <Cpu size={18} />)}
      </div>
      <div className="bubble">
        {showThought && <div className="thought-block">{thought}</div>}
        <div className="markdown-content" style={customColorStyle}>
          <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>{finalResponse}</ReactMarkdown>
        </div>
        <div className="msg-actions">
          <button className="msg-action-btn" title="Copier" onClick={onCopy}><Copy size={14} /></button>
          <button className="msg-action-btn" title="Transformer en note" onClick={onToNote}><FilePlus size={14} /></button>
          <div style={{position:'relative'}}>
            <button className="msg-action-btn" title="Couleur" onClick={() => setShowColorPicker(!showColorPicker)}><Palette size={14} /></button>
            {showColorPicker && (
              <div className="color-picker">
                {['#d4d4d4', '#5bb974', '#eab308', '#ec4899', '#3b82f6'].map(c => (
                  <div key={c} className="color-swatch" style={{background:c}} onClick={() => {onColorChange(c); setShowColorPicker(false);}} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
});

const NoteEditor = memo(({ initialContent, onChange }: { initialContent: string, onChange: (c: string) => void }) => {
  const editableRef = useRef<HTMLDivElement>(null);
  const [savedRange, setSavedRange] = useState<Range | null>(null);

  // Set initial content only ONCE when the component mounts or swaps to avoid cursor jump
  useEffect(() => {
    if (editableRef.current && editableRef.current.innerHTML !== initialContent) {
      editableRef.current.innerHTML = initialContent;
    }
  }, [initialContent]);

  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      setSavedRange(sel.getRangeAt(0));
    }
  };

  const restoreSelection = () => {
    if (savedRange) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(savedRange);
    }
  };

  const execNoteCmd = (cmd: string, val: string | undefined = undefined) => {
    if (cmd === 'foreColor') restoreSelection(); // Restore if we lost it (like clicking color input)
    document.execCommand(cmd, false, val);
    if (editableRef.current) {
      onChange(editableRef.current.innerHTML);
    }
  };

  return (
    <div className="note-editor-container">
      <div className="note-toolbar">
        <button className="toolbar-btn" onMouseDown={e => e.preventDefault()} onClick={() => execNoteCmd('bold')}><b>B</b></button>
        <button className="toolbar-btn" onMouseDown={e => e.preventDefault()} onClick={() => execNoteCmd('italic')}><i>I</i></button>
        <button className="toolbar-btn" onMouseDown={e => e.preventDefault()} onClick={() => execNoteCmd('underline')}><u>U</u></button>
        <button className="toolbar-btn" onMouseDown={e => e.preventDefault()} onClick={() => execNoteCmd('insertUnorderedList')}>• Liste</button>
        <button className="toolbar-btn" onMouseDown={e => e.preventDefault()} onClick={() => execNoteCmd('formatBlock', 'P')}>Normal</button>
        <button className="toolbar-btn" onMouseDown={e => e.preventDefault()} onClick={() => execNoteCmd('formatBlock', 'H1')}>Titre 1</button>
        <button className="toolbar-btn" onMouseDown={e => e.preventDefault()} onClick={() => execNoteCmd('formatBlock', 'H2')}>Titre 2</button>
        <button className="toolbar-btn" onMouseDown={e => e.preventDefault()} onClick={() => execNoteCmd('formatBlock', 'H3')}>Titre 3</button>
        <input type="color" onMouseDown={saveSelection} onChange={(e) => execNoteCmd('foreColor', e.target.value)} title="Couleur de texte" />
      </div>
      <div 
        ref={editableRef}
        className="note-content-area"
        contentEditable
        onInput={e => onChange(e.currentTarget.innerHTML)}
        onKeyUp={saveSelection}
        onMouseUp={saveSelection}
        spellCheck={false}
      />
    </div>
  );
});

const DEFAULT_SYSTEM_PROMPT = "你很有用，你的回答既结构清晰又准确。你幽默风趣，但绝不油腻；偶尔带点讽刺，但始终保持友善和体贴。你的回复很有“人味儿”，不像其他大模型那样空洞无物。你不会使用表情符号，并且能根据用户的语言进行回复。你充分利用 Markdown的所有功能，使文本既美观又清晰易读。";

export default function App() {
  const [items, setItems] = useState<Item[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [noThink, setNoThink] = useState(true); // Default to ON
  const [ollamaUrl, setOllamaUrl] = useState("http://127.0.0.1:11434");
  const [apiKey, setApiKey] = useState("");
  const [terminalLogs, setTerminalLogs] = useState<string[]>([]);
  const [isTerminalOpen, setIsTerminalOpen] = useState(true);

  // New settings
  const [savePath, setSavePath] = useState("");
  const [userAvatar, setUserAvatar] = useState("");
  const [aiAvatar, setAiAvatar] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const activeItem = items.find(c => c.id === activeId);
  const activeIdRef = useRef(activeId);
  const itemsRef = useRef(items);

  useEffect(() => {
    activeIdRef.current = activeId;
    if (activeItem?.type === 'chat' && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeId, activeItem?.messages, activeItem?.type]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    if (terminalRef.current) terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
  }, [terminalLogs]);


  const stopResponse = async () => {
    try {
      await invoke("stop_chat");
      setIsLoading(false);
      toast.info("Réponse interrompue");
    } catch (e) {}
  };

  useEffect(() => {
    const saved = localStorage.getItem("gravity_settings");
    let keyToUse = "";
    if (saved) {
      try {
        const s = JSON.parse(saved);
        setSystemPrompt(s.systemPrompt || DEFAULT_SYSTEM_PROMPT);
        setNoThink(!!s.noThink);
        setOllamaUrl(s.ollamaUrl?.replace("localhost", "127.0.0.1") || "http://127.0.0.1:11434");
        setApiKey(keyToUse);
        setSavePath(s.savePath || "");
        setUserAvatar(s.userAvatar || "");
        setAiAvatar(s.aiAvatar || "");
      } catch (e) {}
    }
    const savedItems = localStorage.getItem("gravity_items");
    if (savedItems && savedItems !== "[]") {
      try {
        const c = JSON.parse(savedItems);
        setItems(c);
        if (c.length > 0) setActiveId(c[c.length-1].id);
      } catch (e) {}
    } else {
      const n: Item = { id: Date.now().toString(), type: 'chat', title: "Nouveau Chat", messages: [] };
      setItems([n]);
      setActiveId(n.id);
    }
    
    const savedFolders = localStorage.getItem("gravity_folders");
    if (savedFolders) {
      try {
        setFolders(JSON.parse(savedFolders));
      } catch(e) {}
    }
    loadModels(keyToUse);
  }, []);

  const saveToMarkdownFile = async (item: Item) => {
    if (!savePath) return;
    try {
      const titleSafe = item.title.replace(/[^a-zA-Z0-9]/g, '_');
      const fileName = `${titleSafe}_${item.id}.md`;
      const filePath = savePath + (savePath.endsWith('/') || savePath.endsWith('\\') ? '' : '/') + fileName;
      
      let mdContent = `# ${item.title}\n\n`;
      if (item.type === 'chat') {
        item.messages.forEach(m => {
          mdContent += `### ${m.role === 'user' ? 'Utilisateur' : 'IA'}\n${m.content}\n\n`;
        });
      } else {
        mdContent += turndownService.turndown(item.content || "");
      }
      
      await writeTextFile(filePath, mdContent);
    } catch (e) {
      console.error("Erreur sauvegarde markdown:", e);
    }
  };

  useEffect(() => {
    const unlisten = listen("chat-delta", (event: any) => {
      const delta = event.payload;
      setItems(prev => {
        const newItems = prev.map(c => {
          if (c.id === activeIdRef.current) {
            const msgs = [...c.messages];
            const last = msgs[msgs.length - 1];
            const contentDelta = delta.message?.content || "";
            
            if (last && last.role === "assistant") {
              const updatedContent = last.content + contentDelta;
              msgs[msgs.length - 1] = { ...last, content: updatedContent };
              return { ...c, messages: msgs };
            } else {
              // Only create a new message if there's actually content
              if (contentDelta || delta.message?.role === "assistant") {
                const newRole: "user" | "assistant" | "system" | "tool" = "assistant";
                return { ...c, messages: [...msgs, { role: newRole, content: contentDelta }] };
              }
            }
          }
          return c;
        });
        return newItems;
      });
    });

    const unlistenLogs = listen("api-log", (event: any) => {
      const log = event.payload;
      setTerminalLogs(prev => [...prev.slice(-199), `[${new Date().toLocaleTimeString()}] ${log}`]);
    });

    return () => { 
      unlisten.then(f => f()); 
      unlistenLogs.then(f => f());
    };
  }, []);

  useEffect(() => {
    localStorage.setItem("gravity_settings", JSON.stringify({ systemPrompt, noThink, ollamaUrl, apiKey, savePath, userAvatar, aiAvatar }));
  }, [systemPrompt, noThink, ollamaUrl, apiKey, savePath, userAvatar, aiAvatar]);

  useEffect(() => {
    localStorage.setItem("gravity_items", JSON.stringify(items));
    localStorage.setItem("gravity_folders", JSON.stringify(folders));
    // Auto save active item logic
    const aItem = items.find(i => i.id === activeId);
    if (aItem && !isLoading && savePath) {
      saveToMarkdownFile(aItem);
    }
  }, [items, folders, isLoading, savePath]);

  const loadModels = async (keyOverride?: string) => {
    try {
      const key = keyOverride !== undefined ? keyOverride : apiKey;
      const m = await invoke<string[]>("get_models", { apiKey: key });
      if (m && m.length > 0) {
        setModels(m);
        if (!selectedModel && m.length > 0) {
          setSelectedModel(m[0]);
        }
      }
    } catch (e) {
      setTerminalLogs(prev => [...prev.slice(-199), `[${new Date().toLocaleTimeString()}] Erreur chargement modèles: ${e}`]);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || isLoading || !selectedModel || !activeId) {
      if (!selectedModel) toast.error("Veuillez sélectionner un modèle");
      return;
    }
    
    setIsLoading(true);
    const trimmedInput = input.trim();

    const userMsg: Message = { role: "user", content: trimmedInput, color: "#eab308" };
    const updated = [...(activeItem?.messages || []), userMsg];
    setItems(prev => prev.map(c => c.id === activeId ? { ...c, messages: updated, title: c.messages.length === 0 ? trimmedInput.slice(0, 20) : c.title } : c));
    setInput("");

    try {
      setTerminalLogs(prev => [...prev.slice(-199), `[${new Date().toLocaleTimeString()}] Envoi chat_stream (Model: ${selectedModel})...`]);
      await invoke("chat_stream", {
        model: selectedModel,
        messages: updated,
        systemPrompt: systemPrompt,
        apiKey: apiKey,
        think: !noThink,
        isOpenai: false
      });
    } catch (e) {
      toast.error("Erreur de connexion");
      setTerminalLogs(prev => [...prev.slice(-199), `[${new Date().toLocaleTimeString()}] Erreur chat_stream: ${e}`]);
    } finally {
      setIsLoading(false);
    }
  };

  const createNewChat = () => {
    const n: Item = { id: Date.now().toString(), type: 'chat', title: "Nouveau Chat", messages: [], color: "var(--accent-color)" };
    setItems([...items, n]);
    setActiveId(n.id);
  };

  const createNewNote = () => {
    const n: Item = { id: Date.now().toString(), type: 'note', title: "Nouvelle Note", messages: [], content: "", color: "#eab308" };
    setItems([...items, n]);
    setActiveId(n.id);
  };

  const handleCopy = (txt: string) => {
    navigator.clipboard.writeText(txt);
    toast.success("Copié dans le presse-papier");
  };

  const handleToNote = async (txt: string) => {
    const renderedHtml = await marked.parse(txt);
    const n: Item = { id: Date.now().toString(), type: 'note', title: "Note extraite", messages: [], content: renderedHtml, color: "#eab308" };
    setItems([...items, n]);
    setActiveId(n.id);
    toast.success("Note créée");
  };

  const handleColorChange = (msgIndex: number, col: string) => {
    setItems(prev => prev.map(c => {
      if (c.id === activeId) {
        const newMsgs = [...c.messages];
        newMsgs[msgIndex] = { ...newMsgs[msgIndex], color: col };
        return { ...c, messages: newMsgs };
      }
      return c;
    }));
  };

  const handlePickPath = async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected && !Array.isArray(selected)) {
        setSavePath(selected);
        toast.success("Chemin enregistré");
      }
    } catch (e) {
      console.error(e);
      toast.error("Erreur sélection du dossier");
    }
  };

  const handleAvatarUpload = (isUser: boolean) => {
    const el = document.createElement("input");
    el.type = "file";
    el.accept = "image/*";
    el.onchange = (e: any) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onloadend = () => {
          if (isUser) setUserAvatar(reader.result as string);
          else setAiAvatar(reader.result as string);
        };
        reader.readAsDataURL(file);
      }
    };
    el.click();
  };

  const updateNoteContent = (html: string) => {
    setItems(prev => prev.map(c => c.id === activeId ? { ...c, content: html } : c));
  };

  const handleRename = (id: string, newName: string, isFolder: boolean = false) => {
    if (newName.trim()) {
      if (isFolder) {
        setFolders(prev => prev.map(f => f.id === id ? { ...f, name: newName.trim() } : f));
      } else {
        setItems(prev => prev.map(c => c.id === id ? { ...c, title: newName.trim() } : c));
      }
    }
    setEditingId(null);
  };

  const createNewFolder = () => {
    setFolders([...folders, { id: 'f_' + Date.now().toString(), name: "Nouveau Dossier", isOpen: true }]);
  };

  const handleDragStart = (e: React.DragEvent, itemId: string) => {
    e.dataTransfer.setData("itemId", itemId);
  };

  const handleDropOnFolder = (e: React.DragEvent, folderId: string | undefined) => {
    e.preventDefault();
    const itemId = e.dataTransfer.getData("itemId");
    if (itemId) {
      setItems(prev => prev.map(c => c.id === itemId ? { ...c, folderId } : c));
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const closeSettings = () => {
    setIsSettingsOpen(false);
    loadModels(apiKey);
  };

  const renderSidebarItem = (c: Item) => (
    <div key={c.id} draggable onDragStart={(e) => handleDragStart(e, c.id)} className={`nav-item ${activeId === c.id ? 'active' : ''}`} onClick={() => setActiveId(c.id)}>
      <span style={{color: c.type === 'note' ? '#eab308' : '#5bb974'}} className="item-icon">
        {c.type === 'note' ? <FileText size={16} /> : <MessageSquare size={16} />}
      </span>
      {editingId === c.id ? (
        <input autoFocus defaultValue={c.title} onClick={e => e.stopPropagation()} onBlur={e => handleRename(c.id, e.target.value)} onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} style={{flex:1, background:'transparent', color:'inherit', border:'none', outline:'none'}} />
      ) : (
        <span style={{flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}} onDoubleClick={(e) => { e.stopPropagation(); setEditingId(c.id); }} title="Double-clic pour renommer">{c.title}</span>
      )}
      <Trash2 size={14} className="delete-icon" style={{marginLeft:'auto', opacity:0.5}} onClick={(e) => { e.stopPropagation(); setItems(items.filter(chat => chat.id !== c.id)); }} />
    </div>
  );

  return (
    <div className={`app-container theme-default`}>
      <Toaster position="top-right" theme="dark" />
      <aside className="sidebar">
        <div className="sidebar-header"><Cpu size={20} /><h1 style={{fontSize:'1.2rem',fontWeight:700}}>Gravity Chat</h1></div>
        <div style={{display:'flex', gap:'0.5rem', marginBottom:'0.5rem'}}>
          <button className="nav-item active" style={{flex:1, border:'1px dashed var(--border-color)', justifyContent:'center'}} onClick={createNewChat}><Plus size={16} /> Chat</button>
          <button className="nav-item active" style={{flex:1, border:'1px dashed var(--border-color)', justifyContent:'center'}} onClick={createNewNote}><Plus size={16} /> Note</button>
        </div>
        <button className="nav-item active" style={{marginBottom:'1rem', border:'1px dashed var(--border-color)', justifyContent:'center'}} onClick={createNewFolder}><FolderPlus size={16} /> Dossier</button>
        
        <div className="sidebar-nav" style={{ flex: 1, overflowY: 'auto' }}>
          {folders.map(f => (
            <div key={f.id} onDragOver={handleDragOver} onDrop={(e) => handleDropOnFolder(e, f.id)} style={{ marginBottom: '0.25rem' }}>
              <div className="nav-item" onClick={() => setFolders(folders.map(fl => fl.id === f.id ? {...fl, isOpen: !fl.isOpen} : fl))} style={{fontWeight: 600, padding:'0.5rem 0.75rem'}}>
                <span style={{marginRight: '0.5rem', color:'var(--accent-color)'}}>
                  {f.isOpen ? <FolderOpen size={16} /> : <Folder size={16} />}
                </span>
                {editingId === f.id ? (
                  <input autoFocus defaultValue={f.name} onClick={e => e.stopPropagation()} onBlur={e => handleRename(f.id, e.target.value, true)} onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} style={{flex:1, background:'transparent', color:'inherit', border:'none', outline:'none', fontSize:'0.85rem'}} />
                ) : (
                  <span style={{flex:1, fontSize:'0.85rem'}} onDoubleClick={(e) => { e.stopPropagation(); setEditingId(f.id); }}>{f.name}</span>
                )}
                <Trash2 size={12} className="delete-icon" style={{marginLeft:'auto', opacity:0.3}} onClick={(e) => { e.stopPropagation(); setFolders(folders.filter(fl => fl.id !== f.id)); setItems(items.map(i => i.folderId === f.id ? {...i, folderId: undefined} : i)); }} />
              </div>
              {f.isOpen && (
                <div style={{ paddingLeft: '0.75rem', borderLeft: '1px solid var(--border-color)', marginLeft: '1.25rem' }}>
                  {items.filter(i => i.folderId === f.id).map(c => renderSidebarItem(c))}
                </div>
              )}
            </div>
          ))}
          
          <div style={{ minHeight: '100px', paddingBottom: '2rem' }} onDragOver={handleDragOver} onDrop={(e) => handleDropOnFolder(e, undefined)}>
            {items.filter(i => !i.folderId).map(c => renderSidebarItem(c))}
          </div>
        </div>
        <div className="sidebar-footer">
          <div className="nav-item" onClick={() => setIsSettingsOpen(true)}><Settings size={18} className="item-icon" /> Paramètres</div>
          <div className="nav-item" onClick={() => setIsTerminalOpen(!isTerminalOpen)}>
            <Cpu size={18} className="item-icon" /> Terminal API
            <div className={`switch ${isTerminalOpen ? 'on' : 'off'}`} style={{marginLeft:'auto', transform:'scale(0.7)'}}></div>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="header">
          <div className="model-selector">
            <Cpu size={14} />
            <select value={selectedModel} onChange={e => setSelectedModel(e.target.value)} style={{background:'transparent',border:'none',color:'inherit',outline:'none', cursor:'pointer'}}>
              <option value="">Choisir un modèle...</option>
              {models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div style={{display:'flex', gap:'0.5rem'}}>
            <button className={`status-badge ${noThink ? 'active' : ''}`} onClick={() => setNoThink(!noThink)}>
              {noThink ? "No-Think: ON" : "No-Think: OFF"}
            </button>
          </div>
        </header>

        {activeItem?.type === 'chat' ? (
          <>
            <div className="chat-container" ref={scrollRef}>
              {activeItem?.messages.length === 0 && (
                <div style={{flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', opacity:0.8}}>
                  <div className="avatar" style={{width:'48px', height:'48px', marginBottom:'1.5rem', background:'var(--glass-bg)', border:'1px solid var(--accent-color)'}}>
                    {aiAvatar ? <img src={aiAvatar} alt="AI" /> : <Cpu size={24} color="var(--accent-color)" />}
                  </div>
                  <h2 style={{fontSize:'0.95rem', fontWeight:400, color:'var(--accent-color)'}}>Comment puis-je vous aider ?</h2>
                </div>
              )}
              {activeItem?.messages.map((m: any, i: number) => (
                <MessageItem key={i} msg={m} noThink={noThink} 
                  onCopy={()=>handleCopy(m.content)}
                  onToNote={()=>handleToNote(m.content)}
                  onColorChange={(color)=>handleColorChange(i, color)}
                  userAvatar={userAvatar} aiAvatar={aiAvatar} />
              ))}
              {isLoading && <div className="message-row assistant"><div className="avatar"><div className="spinner"></div></div><div className="bubble" style={{opacity:0.5}}>Génération...</div></div>}
            </div>
            
            <div className="input-area">
              <div className="input-wrapper">
                <textarea placeholder="Envoyer un message..." value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), sendMessage())} rows={1} />
                <div className="input-actions">
                  <button className="icon-btn"><Upload size={18} /></button>
                  {isLoading ? (
                    <button className="send-btn" onClick={stopResponse} style={{background:'#ef4444'}}>
                      <Square size={18} fill="white" />
                    </button>
                  ) : (
                    <button className="send-btn" onClick={sendMessage} disabled={!input.trim()}><Send size={18} /></button>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : (
          <NoteEditor 
            key={activeItem?.id} 
            initialContent={activeItem?.content || ""} 
            onChange={updateNoteContent} 
          />
        )}

        {isTerminalOpen && (
          <div className="terminal-panel fade-in">
            <div className="terminal-header">
              <span>Terminal API & Backend</span>
              <X size={16} style={{cursor:'pointer'}} onClick={() => setIsTerminalOpen(false)} />
            </div>
            <div className="terminal-body" ref={terminalRef}>
              {terminalLogs.length === 0 && <div className="terminal-line" style={{opacity:0.3}}>En attente de logs API...</div>}
              {terminalLogs.map((log, i) => <div key={i} className="terminal-line">{log}</div>)}
            </div>
          </div>
        )}
      </main>

      {isSettingsOpen && (
        <div className="modal-overlay" onClick={closeSettings}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div style={{display:'flex', justifyContent:'space-between', marginBottom:'1.5rem'}}>
              <h2 className="modal-title">Paramètres</h2>
              <X size={20} style={{cursor:'pointer'}} onClick={closeSettings} />
            </div>
            <div style={{marginTop:'1.5rem'}}>
                <>
                  <div className="settings-avatars">
                    <div className="avatar-upload" onClick={() => handleAvatarUpload(true)}>
                      <div className="avatar-preview">
                        {userAvatar ? <img src={userAvatar} alt="U" /> : <ImageIcon size={24} color="var(--text-secondary)" />}
                      </div>
                      <span className="form-label" style={{margin:0}}>Utilisateur</span>
                    </div>
                    <div className="avatar-upload" onClick={() => handleAvatarUpload(false)}>
                      <div className="avatar-preview">
                        {aiAvatar ? <img src={aiAvatar} alt="AI" /> : <Cpu size={24} color="var(--text-secondary)" />}
                      </div>
                      <span className="form-label" style={{margin:0}}>IA Avatar</span>
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Dossier de sauvegarde des fichiers (Markdown)</label>
                    <div style={{display:'flex', gap:'0.5rem'}}>
                      <input type="text" value={savePath} readOnly className="form-input" placeholder="Sélectionner un dossier..." style={{flex:1}} />
                      <button className="nav-item active" style={{padding:'0.5rem 1rem'}} onClick={handlePickPath}>Parcourir</button>
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Clé API Ollama Cloud</label>
                    <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} className="form-input" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Prompt Système</label>
                    <textarea value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} className="form-input" style={{minHeight:'60px'}} />
                  </div>
                </>
            </div>
            <button className="nav-item active" style={{width:'100%',justifyContent:'center',background:'var(--accent-color)',color:'white', marginTop:'1.5rem'}} onClick={closeSettings}>Enregistrer et Fermer</button>
          </div>
        </div>
      )}
    </div>
  );
}
