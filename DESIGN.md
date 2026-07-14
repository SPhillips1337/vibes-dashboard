---
name: vibes-dashboard
description: "Futuristic glassmorphism visual language for the Vibes Dashboard."

colors:
  primary: "#3b82f6"
  secondary: "#60a5fa"
  background: "#0a0a0c"
  surface: "rgba(20, 20, 25, 0.7)"
  surface-hover: "rgba(255, 255, 255, 0.05)"
  border: "rgba(255, 255, 255, 0.1)"
  text-primary: "#f8fafc"
  text-secondary: "#94a3b8"
  success: "#10b981"
  warning: "#f59e0b"
  danger: "#ef4444"

typography:
  font-main: "'Inter', sans-serif"
  font-accent: "'Outfit', sans-serif"

rounded:
  base: "8px"
  panel: "16px"

spacing:
  base: "8px"
  panel-gap: "16px"

glass:
  blur: "12px"
  border-width: "1px"

reactive:
  glow-opacity: "Dynamic (0.1 - 0.5)"
  energy: "Dynamic (0.0 - 1.0)"

references:
  - label: Refero DESIGN.md examples for AI agents
    url: "https://styles.refero.design/ai-agents/design-md-examples"
  - label: Vibes Dashboard DESIGN.md repo
    url: "https://github.com/Panniantong/vibes-dashboard"
---

# 🌌 Vibes Dashboard: Design System

This document defines the visual language and component schema for the Vibes Dashboard. AI agents should use these rules to ensure consistency across the UI.

## 🎨 Visual Identity
The dashboard is a premium, futuristic interface that feels "alive." It uses a **Dark Mode** foundation with **Glassmorphism** overlays.

- **Theme**: High-contrast dark backgrounds with vibrant blue accents.
- **Atmosphere**: Professional yet energetic (inspired by cybernetic control centers).

## 💎 Design Principles

### 1. Glassmorphism (Core)
All panels, cards, and modals MUST implement the glass effect:
- **Background**: `rgba(20, 20, 25, 0.7)`
- **Blur**: `backdrop-filter: blur(12px)`
- **Border**: `1px solid rgba(255, 255, 255, 0.1)`
- **Shadow**: Deep, soft shadows for depth (`rgba(0, 0, 0, 0.4)`).

### 2. Interaction & State
- **Hover**: Elements should "lift" or glow. Borders transition to full white or the primary accent.
- **Active**: Vibrant shadows and increased saturation of accents.
- **Animations**: Use `cubic-bezier(0.4, 0, 0.2, 1)` for all transitions.

## 🏗️ Component Schema

### 🛰️ Sidebar (Control Strip)
- **Position**: Left-hand vertical.
- **Width**: `64px` to `80px`.
- **Icons**: Minimalist SVG icons. Active state uses the `--primary` color glow.

### 🃏 Agent Cards
- **Structure**: Glass container with `16px` border radius.
- **Content**: Mission title, animated progress bar, status badges.
- **Header**: Contains a small "X" close button in the top-right.
- **Interaction**: Expand to full-screen modal on click.

### ➕ Placeholder Card (Add Agent)
- **Style**: Dashed border (`2px dashed var(--border)`).
- **Content**: Large centered `+` symbol.
- **Hover**: Border and symbol transition to `#ffffff` with a subtle glow.

### 🪄 Modals
- **Style**: Centered glass panels.
- **Animations**: Fade-in and scale-up from center.
- **Buttons**: Glass style with gradients (`linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%)`).

## 🎼 Reactive Visuals
- **Visualizer**: Canvas-based frequency visualizer reacting to audio.
- **Color Shifts**: Subtle hue rotation of accents (±15deg) based on user activity or audio energy.

## 🛡️ Guardrails (Do Not)
- **❌ DO NOT** use opaque backgrounds (e.g., `#ffffff` or `#000000`) for UI panels.
- **❌ DO NOT** use Tailwind default colors; strictly use the defined hex codes.
- **❌ DO NOT** use standard browser fonts (Serif/Sans-serif); strictly use Inter or Outfit.
- **❌ DO NOT** create sharp-cornered elements; everything must have a radius.
