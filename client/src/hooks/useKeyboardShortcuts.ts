import { useEffect, useCallback } from 'react';

interface ShortcutAction {
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  action: () => void;
  description: string;
}

export function useKeyboardShortcuts(shortcuts: ShortcutAction[], enabled: boolean = true) {
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!enabled) return;
    
    // Ignore shortcuts when typing in input fields
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      // Allow Escape and some shortcuts even in inputs
      if (event.key !== 'Escape') {
        return;
      }
    }

    for (const shortcut of shortcuts) {
      const keyMatch = event.key.toLowerCase() === shortcut.key.toLowerCase();
      const ctrlMatch = !shortcut.ctrl || (event.ctrlKey || event.metaKey);
      const altMatch = !shortcut.alt || event.altKey;
      const shiftMatch = !shortcut.shift || event.shiftKey;

      if (keyMatch && ctrlMatch && altMatch && shiftMatch) {
        event.preventDefault();
        shortcut.action();
        return;
      }
    }
  }, [shortcuts, enabled]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}

export const KEYBOARD_SHORTCUTS = [
  { key: '1', description: 'Go to Dashboard' },
  { key: '2', description: 'Go to Conversations' },
  { key: '3', description: 'Go to Visitors' },
  { key: '4', description: 'Go to Statistics' },
  { key: '5', description: 'Go to Settings' },
  { key: 'Escape', description: 'Close chat / dialog' },
  { key: 'a', description: 'Toggle availability status' },
  { key: 'n', description: 'Toggle notifications' },
  { key: 's', description: 'Toggle sound alerts' },
  { key: 'r', description: 'Refresh data' },
  { key: '?', description: 'Show keyboard shortcuts' },
];
