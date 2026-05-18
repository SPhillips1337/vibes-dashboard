#!/usr/bin/env bash

# Vibes & Vibes Dashboard Automated Installer
# 🌌 Maximize Momentum. Minimize Gravity.

set -euo pipefail

# ANSI color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

clear
echo -e "${MAGENTA}"
echo "   ╦  ╦╦┌┐┐┌─┐┌─┐  ┌┬┐┌─┐┌─┐┬ ┬┌┐ ┌─┐┌─┐┬─┐┌┬┐"
echo "   ╚╗╔╝║├┴┐├─ └─┐   ││├─┤└─┐├─┤├┴┐│ │├─┤├┬┘ ││"
echo "    ╚╝ ╩┴ └└─┘└─┘  ─┴┘┴ ┴└─┘┴ ┴└─┘└─┘┴ ┴┴└──┴┘"
echo "  🌌 Vibes Dashboard & Core CLI Installer"
echo -e "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

# Prerequisite Checks
echo -e "🔍 Checking system prerequisites..."

deps=("node" "npm" "git" "curl")
for dep in "${deps[@]}"; do
    if ! command -v "$dep" >/dev/null 2>&1; then
        echo -e "${RED}❌ Error: '$dep' is required but not installed on this system.${NC}" >&2
        exit 1
    fi
    echo -e "  - $dep: ${GREEN}OK${NC}"
done

NODE_VERSION=$(node -v | cut -d'v' -f2)
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d'.' -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
    echo -e "${YELLOW}⚠️ Warning: Node.js version 18+ is recommended. Found: v$NODE_VERSION${NC}"
fi

# Define Installation Directories
INSTALL_ROOT="${HOME}/.vibes-stack"
DASHBOARD_DIR="${INSTALL_ROOT}/dashboard"
CORE_DIR="${INSTALL_ROOT}/core"
BIN_DIR="${HOME}/.local/bin"

mkdir -p "$INSTALL_ROOT"
mkdir -p "$BIN_DIR"

echo -e "\n📥 ${BLUE}Cloning repositories into ${INSTALL_ROOT}...${NC}"

# Clone Dashboard
if [ -d "$DASHBOARD_DIR" ]; then
    echo -e "  - Dashboard directory already exists. Pulling latest..."
    cd "$DASHBOARD_DIR" && git pull
else
    echo -e "  - Cloning Vibes Dashboard..."
    git clone https://github.com/SPhillips1337/vibes-dashboard.git "$DASHBOARD_DIR"
fi

# Clone Vibes Core CLI
if [ -d "$CORE_DIR" ]; then
    echo -e "  - Vibes Core CLI directory already exists. Pulling latest..."
    cd "$CORE_DIR" && git pull
else
    echo -e "  - Cloning Vibes Core CLI..."
    git clone https://github.com/SPhillips1337/Vibes.git "$CORE_DIR" || \
    git clone https://github.com/stephen/Vibes.git "$CORE_DIR" || \
    echo -e "${YELLOW}⚠️ Notice: Core repository not publicly resolved yet. Installing local folder reference if available...${NC}"
fi

# Install Dashboard Dependencies & Setup HTTPS
echo -e "\n⚙️ ${BLUE}Configuring Vibes Dashboard...${NC}"
cd "$DASHBOARD_DIR"
echo "  - Installing npm packages..."
npm install --quiet

echo "  - Generating local SSL certificates (for Speech API/microphone authorization)..."
if [ -f generate_cert.sh ]; then
    bash generate_cert.sh > /dev/null 2>&1 || echo -e "  - ${YELLOW}Skipped cert generation (already configured or run manually)${NC}"
fi

# Configure and Build Vibes Core CLI
if [ -d "$CORE_DIR" ]; then
    echo -e "\n⚙️ ${BLUE}Configuring Vibes Core CLI...${NC}"
    cd "$CORE_DIR"
    echo "  - Installing core npm packages..."
    npm install --quiet
    
    echo "  - Building typescript CLI files..."
    npm run build --quiet || echo -e "  - ${YELLOW}TypeScript build skipped or failed. Using dynamic compiler run wrapper.${NC}"
fi

# Set up global vibes wrapper command
echo -e "\n🔗 ${BLUE}Linking global 'vibes' command...${NC}"
VIBES_BIN="${BIN_DIR}/vibes"

# Create core binary runner wrapper
cat << 'EOF' > "$VIBES_BIN"
#!/usr/bin/env bash
# Vibes CLI Wrapper
set -euo pipefail
CORE_DIR="${HOME}/.vibes-stack/core"
if [ -f "${CORE_DIR}/dist/index.js" ]; then
    exec node "${CORE_DIR}/dist/index.js" "$@"
else
    exec npx -y tsx --no-warnings "${CORE_DIR}/src/index.tsx" "$@"
fi
EOF

chmod +x "$VIBES_BIN"

# Check if PATH contains ~/.local/bin
PATH_EXISTS=false
case ":$PATH:" in
    *":$BIN_DIR:"*) PATH_EXISTS=true ;;
esac

echo -e "\n🌌 ${GREEN}Vibes Stack Installed Successfully!${NC}"
echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "✦ ${CYAN}Vibes Dashboard location:${NC} $DASHBOARD_DIR"
echo -e "✦ ${CYAN}Vibes Core CLI location:${NC} $CORE_DIR"
echo -e "✦ ${CYAN}Global binary linked to:${NC} $VIBES_BIN"
echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ "$PATH_EXISTS" = false ]; then
    echo -e "${YELLOW}💡 Action required: Add ~/.local/bin to your system PATH to run the global 'vibes' command.${NC}"
    echo -e "Run the following command or append it to your ${WHITE}~/.bashrc${NC} or ${WHITE}~/.zshrc${NC}:"
    echo -e "  ${CYAN}export PATH=\"\$HOME/.local/bin:\$PATH\"${NC}"
fi

echo -e "\n🚀 ${GREEN}To launch the Dashboard:${NC}"
echo -e "  cd $DASHBOARD_DIR && npm start"
echo -e "  Then visit: ${BLUE}https://localhost:9000${NC} (Chrome/Edge secure microphone context)"

echo -e "\n💻 ${GREEN}To run Vibes CLI globally:${NC}"
echo -e "  vibes \"Create a hello world landing page\""
echo ""
