# Maintainer: Nikos <nikos@example.com>
pkgname=gravity-chat
pkgver=0.1.0
pkgrel=1
pkgdesc="A powerful AI chat application with local and cloud model support."
arch=('x86_64')
url="https://github.com/Nikos-Unilasalle/Gravity-Chat"
license=('MIT')
depends=('webkit2gtk-4.1' 'gtk3' 'libsoup3' 'openssl')
makedepends=('cargo' 'nodejs' 'npm' 'rust' 'git')
source=("${pkgname}::git+https://github.com/Nikos-Unilasalle/Gravity-Chat.git"
        "gravity-chat.desktop")
sha256sums=('SKIP' 'SKIP')

build() {
  cd "$srcdir/$pkgname"
  
  # Build the frontend
  npm install
  npm run build
  
  # Build the Tauri application
  cd src-tauri
  cargo build --release
}

package() {
  cd "$srcdir/$pkgname"
  
  # Install the binary
  install -Dm755 "src-tauri/target/release/gravity-chat" "$pkgdir/usr/bin/gravity-chat"
  
  # Install the icon
  install -Dm644 "src-tauri/icons/128x128.png" "$pkgdir/usr/share/icons/hicolor/128x128/apps/gravity-chat.png"
  
  # Install the .desktop file
  install -Dm644 "../gravity-chat.desktop" "$pkgdir/usr/share/applications/gravity-chat.desktop"
}
