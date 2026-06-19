import { createContext, useContext, useState } from "react";

interface ChatDrawerCtx {
  isOpen:  boolean;
  toggle:  () => void;
  open:    () => void;
  close:   () => void;
}

const ChatDrawerContext = createContext<ChatDrawerCtx>({
  isOpen: false, toggle: () => {}, open: () => {}, close: () => {},
});

export function ChatDrawerProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <ChatDrawerContext.Provider value={{
      isOpen,
      toggle: () => setIsOpen(v => !v),
      open:   () => setIsOpen(true),
      close:  () => setIsOpen(false),
    }}>
      {children}
    </ChatDrawerContext.Provider>
  );
}

export const useChatDrawer = () => useContext(ChatDrawerContext);
