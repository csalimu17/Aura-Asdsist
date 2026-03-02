import React, { useState, useEffect, useRef } from 'react';
import { 
  MessageSquare, 
  Plus, 
  Settings, 
  History, 
  Send, 
  User as UserIcon, 
  Bot, 
  MoreVertical, 
  Trash2, 
  ChevronLeft, 
  ChevronRight,
  ChevronDown,
  Sparkles,
  Command,
  Mic,
  MicOff,
  Sun,
  Moon,
  Download,
  Search,
  X,
  Quote,
  Copy,
  Check,
  Pencil,
  AlertCircle,
  RefreshCcw,
  Code,
  PenTool,
  Compass,
  Lightbulb,
  Pin,
  PinOff,
  Globe,
  Image as ImageIcon,
  Volume2,
  Paperclip,
  ExternalLink,
  Keyboard,
  LogIn
} from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { motion, AnimatePresence } from 'motion/react';
import { format, isToday, isYesterday, isAfter, subDays } from 'date-fns';
import { cn } from './lib/utils';
import { gemini, Message, ChatSession, User } from './services/geminiService';
import Auth from './components/Auth';

const STORAGE_KEYS = {
  SESSIONS: 'aura_sessions',
  PINNED: 'aura_pinned_sessions',
  SYSTEM: 'aura_system_instruction',
  MODEL: 'aura_selected_model',
  THEME: 'aura_theme',
  AUTO_SAVE: 'aura_auto_save'
};

export default function App() {
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.SESSIONS);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (e) {}
    }
    return [{
      id: crypto.randomUUID(),
      title: 'New Conversation',
      messages: [],
      updatedAt: Date.now()
    }];
  });

  const [currentSessionId, setCurrentSessionId] = useState<string | null>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.SESSIONS);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed[0].id;
      } catch (e) {}
    }
    return null;
  });

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.THEME) as 'light' | 'dark';
    if (saved) return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [quotedMessage, setQuotedMessage] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [pinnedSessionIds, setPinnedSessionIds] = useState<string[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.PINNED);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) {}
    }
    return [];
  });
  const [useSearch, setUseSearch] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState<string | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [autoSaveHistory, setAutoSaveHistory] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.AUTO_SAVE);
    return saved !== null ? saved === 'true' : true;
  });
  const [systemInstruction, setSystemInstruction] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.SYSTEM);
    return saved || "You are Aura, a highly intelligent and helpful AI assistant. You provide clear, concise, and accurate information. You are professional yet approachable. Use markdown for formatting when appropriate.";
  });
  const [selectedModel, setSelectedModel] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.MODEL);
    return saved || "gemini-3.1-pro-preview";
  });
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handleQuote = (content: string) => {
    const quote = content.split('\n').map(line => `> ${line}`).join('\n');
    setInput(prev => `${quote}\n\n${prev}`);
    textareaRef.current?.focus();
  };

  const handleEdit = (messageId: string, content: string) => {
    setInput(content);
    setEditingMessageId(messageId);
    textareaRef.current?.focus();
    textareaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const cancelEdit = () => {
    setEditingMessageId(null);
    setInput('');
  };

  const handleRetry = async (messageId: string) => {
    if (!currentSessionId || isLoading) return;
    
    const session = sessions.find(s => s.id === currentSessionId);
    if (!session) return;

    const errorMsgIndex = session.messages.findIndex(m => m.id === messageId);
    if (errorMsgIndex === -1) return;

    const userMsg = session.messages[errorMsgIndex - 1];
    if (!userMsg || userMsg.role !== 'user') return;

    setSessions(prev => prev.map(s => {
      if (s.id === currentSessionId) {
        return {
          ...s,
          messages: s.messages.filter(m => m.id !== messageId)
        };
      }
      return s;
    }));

    handleSend(userMsg.content);
  };

  const togglePin = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPinnedSessionIds(prev => 
      prev.includes(id) ? prev.filter(p => p !== id) : [id, ...prev]
    );
  };

  const downloadConversation = () => {
    if (!currentSession) return;
    
    const content = currentSession.messages.map(m => 
      `${m.role.toUpperCase()} (${format(m.timestamp, 'yyyy-MM-dd HH:mm:ss')}):\n${m.content}\n\n`
    ).join('---\n\n');
    
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aura-chat-${currentSession.title.toLowerCase().replace(/\s+/g, '-')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportToJson = () => {
    if (!currentSession) return;
    const blob = new Blob([JSON.stringify(currentSession, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aura-chat-${currentSession.title.toLowerCase().replace(/\s+/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const copyAllMessages = () => {
    if (!currentSession) return;
    const content = currentSession.messages.map(m => 
      `${m.role.toUpperCase()}:\n${m.content}\n`
    ).join('\n---\n\n');
    navigator.clipboard.writeText(content);
  };

  const clearCurrentChat = () => {
    if (!currentSessionId) return;
    if (confirm('Clear all messages in this conversation?')) {
      setSessions(prev => prev.map(s => 
        s.id === currentSessionId ? { ...s, messages: [], updatedAt: Date.now() } : s
      ));
    }
  };

  const handleRegenerate = async () => {
    if (!currentSessionId || isLoading) return;
    
    const session = sessions.find(s => s.id === currentSessionId);
    if (!session || session.messages.length === 0) return;

    const lastMessage = session.messages[session.messages.length - 1];
    if (lastMessage.role !== 'model') return;

    const userMsg = session.messages[session.messages.length - 2];
    if (!userMsg || userMsg.role !== 'user') return;

    setSessions(prev => prev.map(s => {
      if (s.id === currentSessionId) {
        return {
          ...s,
          messages: s.messages.slice(0, -1)
        };
      }
      return s;
    }));

    handleSend(userMsg.content);
  };

  const CopyButton = ({ text }: { text: string }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };

    return (
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 p-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white/50 hover:text-white transition-all z-10"
        title="Copy code"
      >
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    );
  };

  // Scroll to bottom logic
  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior, block: 'end' });
    }
  };

  // Scroll on session change or initial load
  useEffect(() => {
    scrollToBottom('auto');
  }, [currentSessionId]);

  // Ensure currentSessionId is set if sessions exist
  useEffect(() => {
    if (!currentSessionId && sessions.length > 0) {
      setCurrentSessionId(sessions[0].id);
    }
  }, [sessions, currentSessionId]);

  const currentSession = sessions.find(s => s.id === currentSessionId);

  // Scroll on new messages or streaming updates
  useEffect(() => {
    const lastMessage = currentSession?.messages[currentSession.messages.length - 1];
    if (lastMessage) {
      scrollToBottom('smooth');
    }
  }, [currentSession?.messages.length, currentSession?.messages[currentSession?.messages.length - 1]?.content, isLoading]);

  // Apply theme to document
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  // Check for existing user on mount
  useEffect(() => {
    const checkUser = async () => {
      try {
        const response = await fetch('/api/auth/me');
        const data = await response.json();
        if (data.user) {
          setUser(data.user);
          
          // Load sessions from backend
          const sessionsRes = await fetch('/api/sessions');
          const sessionsData = await sessionsRes.json();
          if (Array.isArray(sessionsData) && sessionsData.length > 0) {
            setSessions(sessionsData);
            setCurrentSessionId(sessionsData[0].id);
          }

          // Load settings from backend
          const settingsRes = await fetch('/api/settings');
          const settingsData = await settingsRes.json();
          if (settingsData.user_id) {
            if (settingsData.system_instruction) setSystemInstruction(settingsData.system_instruction);
            if (settingsData.selected_model) setSelectedModel(settingsData.selected_model);
            if (settingsData.theme) setTheme(settingsData.theme as 'light' | 'dark');
            setAutoSaveHistory(!!settingsData.auto_save);
          }
        }
      } catch (err) {
        console.error('Failed to check user:', err);
      }
    };
    checkUser();
  }, []);

  // Sync settings to backend
  useEffect(() => {
    if (user) {
      const syncSettings = async () => {
        try {
          await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              system_instruction: systemInstruction,
              selected_model: selectedModel,
              theme: theme,
              auto_save: autoSaveHistory
            }),
          });
        } catch (err) {
          console.error('Failed to sync settings:', err);
        }
      };
      syncSettings();
    }
  }, [user, systemInstruction, selectedModel, theme, autoSaveHistory]);

  // Sync sessions to backend
  useEffect(() => {
    if (user && autoSaveHistory) {
      const syncSessions = async () => {
        setIsSyncing(true);
        try {
          // Sync each session (in a real app, you'd probably only sync the current one or use a more efficient method)
          // For now, let's just sync the current session when it changes
          const currentSess = sessions.find(s => s.id === currentSessionId);
          if (currentSess) {
            await fetch('/api/sessions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(currentSess),
            });
          }
        } catch (err) {
          console.error('Failed to sync sessions:', err);
        } finally {
          setIsSyncing(false);
        }
      };
      syncSessions();
    }
  }, [sessions, user, autoSaveHistory, currentSessionId]);

  // PWA Install Prompt
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  const installPWA = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };
  const handleAuthSuccess = async (userData: User) => {
    setUser(userData);
    setIsAuthOpen(false);
    
    try {
      // Reload sessions from backend
      const sessionsRes = await fetch('/api/sessions');
      const sessionsData = await sessionsRes.json();
      if (Array.isArray(sessionsData) && sessionsData.length > 0) {
        setSessions(sessionsData);
        setCurrentSessionId(sessionsData[0].id);
      }

      // Reload settings from backend
      const settingsRes = await fetch('/api/settings');
      const settingsData = await settingsRes.json();
      if (settingsData.user_id) {
        if (settingsData.system_instruction) setSystemInstruction(settingsData.system_instruction);
        if (settingsData.selected_model) setSelectedModel(settingsData.selected_model);
        if (settingsData.theme) setTheme(settingsData.theme as 'light' | 'dark');
        setAutoSaveHistory(!!settingsData.auto_save);
      }
    } catch (err) {
      console.error('Failed to load data after auth:', err);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      setUser(null);
      // Reset to local storage or defaults
      const savedSessions = localStorage.getItem(STORAGE_KEYS.SESSIONS);
      if (savedSessions) {
        const parsed = JSON.parse(savedSessions);
        setSessions(parsed);
        if (parsed.length > 0) setCurrentSessionId(parsed[0].id);
      } else {
        setSessions([]);
        setCurrentSessionId(null);
      }
    } catch (err) {
      console.error('Failed to logout:', err);
    }
  };

  const handleCopyMessage = async (id: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageId(id);
      setTimeout(() => setCopiedMessageId(null), 2000);
    } catch (err) {
      console.error('Failed to copy message:', err);
    }
  };

  const toggleAutoSave = () => {
    const newVal = !autoSaveHistory;
    setAutoSaveHistory(newVal);
    localStorage.setItem(STORAGE_KEYS.AUTO_SAVE, String(newVal));
  };

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    localStorage.setItem(STORAGE_KEYS.THEME, newTheme);
  };

  // Initialize Speech Recognition
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event: any) => {
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          }
        }
        if (finalTranscript) {
          setInput(prev => prev + (prev ? ' ' : '') + finalTranscript);
        }
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }
  }, []);

  const toggleListening = () => {
    if (!recognitionRef.current) {
      alert('Speech recognition is not supported in your browser.');
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
    } else {
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch (error) {
        console.error('Failed to start recognition:', error);
      }
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        createNewSession();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        // Focus search
        const searchInput = document.querySelector('input[placeholder="Search history..."]') as HTMLInputElement;
        searchInput?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Save sessions to localStorage
  useEffect(() => {
    if (autoSaveHistory) {
      localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(sessions));
    }
  }, [sessions, autoSaveHistory]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.PINNED, JSON.stringify(pinnedSessionIds));
  }, [pinnedSessionIds]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.SYSTEM, systemInstruction);
  }, [systemInstruction]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.MODEL, selectedModel);
  }, [selectedModel]);

  const filteredSessions = sessions.filter(session => 
    session.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    session.messages.some(m => m.content.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const groupedSessions = filteredSessions.reduce((acc, session) => {
    const date = new Date(session.updatedAt);
    let group = 'Older';
    if (isToday(date)) group = 'Today';
    else if (isYesterday(date)) group = 'Yesterday';
    else if (isAfter(date, subDays(new Date(), 7))) group = 'Previous 7 Days';
    
    if (pinnedSessionIds.includes(session.id)) group = 'Pinned';

    if (!acc[group]) acc[group] = [];
    acc[group].push(session);
    return acc;
  }, {} as Record<string, ChatSession[]>);

  // Sort groups to ensure Pinned is at top
  const sortedGroups = Object.entries(groupedSessions).sort(([a], [b]) => {
    if (a === 'Pinned') return -1;
    if (b === 'Pinned') return 1;
    return 0;
  });

  const createNewSession = () => {
    const newSession: ChatSession = {
      id: crypto.randomUUID(),
      title: 'New Conversation',
      messages: [],
      updatedAt: Date.now()
    };
    setSessions(prev => [newSession, ...prev]);
    setCurrentSessionId(newSession.id);
  };

  const deleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSessions(prev => {
      const filtered = prev.filter(s => s.id !== id);
      if (currentSessionId === id) {
        setCurrentSessionId(filtered.length > 0 ? filtered[0].id : null);
      }
      return filtered;
    });

    if (user) {
      try {
        await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
      } catch (err) {
        console.error('Failed to delete session from backend:', err);
      }
    }
  };

  const clearAllSessions = async () => {
    if (confirm('Are you sure you want to delete all chat history? This action cannot be undone.')) {
      setSessions([]);
      setCurrentSessionId(null);
      localStorage.removeItem(STORAGE_KEYS.SESSIONS);

      if (user) {
        try {
          await fetch('/api/sessions', { method: 'DELETE' });
        } catch (err) {
          console.error('Failed to clear sessions from backend:', err);
        }
      }
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSpeak = async (messageId: string, text: string) => {
    if (isSpeaking === messageId) {
      window.speechSynthesis.cancel();
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setIsSpeaking(null);
      return;
    }

    // Stop existing audio if any
    window.speechSynthesis.cancel();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    setIsSpeaking(messageId);
    try {
      const audioUrl = await gemini.textToSpeech(text);
      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      audio.onended = () => {
        setIsSpeaking(null);
        audioRef.current = null;
      };
      audio.onerror = () => {
        setIsSpeaking(null);
        audioRef.current = null;
      };
      audio.play();
    } catch (error) {
      console.error('TTS error:', error);
      // Fallback to browser TTS
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.onend = () => setIsSpeaking(null);
      utterance.onerror = () => setIsSpeaking(null);
      window.speechSynthesis.speak(utterance);
    }
  };

  const handleGenerateImage = async () => {
    if (!input.trim() || !currentSessionId || isLoading) return;
    
    const prompt = input.trim();
    setInput('');
    setIsLoading(true);
    setIsGeneratingImage(true);

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: `Generate an image: ${prompt}`,
      timestamp: Date.now(),
      status: 'sent'
    };

    setSessions(prev => prev.map(s => {
      if (s.id === currentSessionId) {
        return { ...s, messages: [...s.messages, userMessage], updatedAt: Date.now() };
      }
      return s;
    }));

    try {
      const imageUrl = await gemini.generateImage(prompt);
      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: 'model',
        content: `Here is the image you requested: "${prompt}"`,
        timestamp: Date.now(),
        type: 'image',
        imageUrl: imageUrl,
        status: 'sent'
      };

      setSessions(prev => prev.map(s => {
        if (s.id === currentSessionId) {
          return { ...s, messages: [...s.messages, assistantMessage], updatedAt: Date.now() };
        }
        return s;
      }));
    } catch (error: any) {
      console.error('Image generation error:', error);
      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: 'model',
        content: `Failed to generate image: ${error?.message || "I encountered an error while generating the image. Please try again."}`,
        timestamp: Date.now(),
        error: true,
        status: 'error'
      };

      setSessions(prev => prev.map(s => {
        if (s.id === currentSessionId) {
          return { ...s, messages: [...s.messages, assistantMessage], updatedAt: Date.now() };
        }
        return s;
      }));
    } finally {
      setIsLoading(false);
      setIsGeneratingImage(false);
    }
  };

  const deleteMessage = (messageId: string) => {
    setSessions(prev => prev.map(s => {
      if (s.id === currentSessionId) {
        return {
          ...s,
          messages: s.messages.filter(m => m.id !== messageId)
        };
      }
      return s;
    }));
  };

  const startRenaming = (id: string, currentTitle: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingSessionId(id);
    setRenameValue(currentTitle);
  };

  const saveRename = async (id: string) => {
    if (!renameValue.trim()) {
      setRenamingSessionId(null);
      return;
    }
    const updatedTitle = renameValue.trim();
    setSessions(prev => prev.map(s => 
      s.id === id ? { ...s, title: updatedTitle, updatedAt: Date.now() } : s
    ));
    setRenamingSessionId(null);

    if (user) {
      try {
        const sess = sessions.find(s => s.id === id);
        if (sess) {
          await fetch('/api/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...sess, title: updatedTitle, updatedAt: Date.now() }),
          });
        }
      } catch (err) {
        console.error('Failed to sync renamed session:', err);
      }
    }
  };

  const stopStreaming = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsLoading(false);
    }
  };

  const handleSend = async (overrideInput?: string) => {
    const currentInput = overrideInput !== undefined ? overrideInput : input;
    if ((!currentInput.trim() && !selectedImage) || isLoading) return;

    let activeSessionId = currentSessionId;
    let updatedSessions = [...sessions];

    // If no session exists, create one first
    if (!activeSessionId) {
      const newSession: ChatSession = {
        id: crypto.randomUUID(),
        title: (currentInput || "New Conversation").slice(0, 30),
        messages: [],
        updatedAt: Date.now()
      };
      updatedSessions = [newSession, ...sessions];
      setSessions(updatedSessions);
      setCurrentSessionId(newSession.id);
      activeSessionId = newSession.id;
    }

    const currentImage = selectedImage;
    
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: currentInput || (currentImage ? "Analyze this image" : ""),
      timestamp: Date.now(),
      status: 'sent',
      imageUrl: currentImage || undefined
    };

    const assistantMessageId = crypto.randomUUID();
    const assistantPlaceholder: Message = {
      id: assistantMessageId,
      role: 'model',
      content: '',
      timestamp: Date.now(),
      status: 'sending'
    };

    if (editingMessageId) {
      updatedSessions = updatedSessions.map(s => {
        if (s.id === activeSessionId) {
          const msgIndex = s.messages.findIndex(m => m.id === editingMessageId);
          if (msgIndex !== -1) {
            return {
              ...s,
              messages: [...s.messages.slice(0, msgIndex), userMessage, assistantPlaceholder],
              updatedAt: Date.now()
            };
          }
        }
        return s;
      });
      setEditingMessageId(null);
    } else {
      updatedSessions = updatedSessions.map(s => {
        if (s.id === activeSessionId) {
          return {
            ...s,
            messages: [...s.messages, userMessage, assistantPlaceholder],
            updatedAt: Date.now(),
            title: s.messages.length === 0 ? (currentInput || "Image Analysis").slice(0, 30) : s.title
          };
        }
        return s;
      });
    }

    setSessions(updatedSessions);
    setInput('');
    setSelectedImage(null);
    setIsLoading(true);
    abortControllerRef.current = new AbortController();

    try {
      let assistantContent = '';
      let groundingUrls: { uri: string; title: string }[] = [];

      const currentSess = updatedSessions.find(s => s.id === activeSessionId);
      const history = currentSess?.messages || [];
      // History for Gemini should exclude the placeholder we just added
      const geminiHistory = history.filter(m => m.id !== assistantMessageId && m.id !== userMessage.id);

      if (currentImage) {
        const [header, base64Data] = currentImage.split(',');
        const mimeType = header.match(/:(.*?);/)?.[1] || 'image/png';
        const result = await gemini.analyzeImage(currentInput, base64Data, mimeType);
        assistantContent = result || "I couldn't analyze the image.";
        
        setSessions(prev => prev.map(s => {
          if (s.id === activeSessionId) {
            return {
              ...s,
              messages: s.messages.map(m => 
                m.id === assistantMessageId ? { ...m, content: assistantContent, status: 'sent' } : m
              )
            };
          }
          return s;
        }));
      } else {
        const stream = gemini.chatStream(currentInput, geminiHistory, useSearch, systemInstruction, selectedModel);
        
        for await (const chunk of stream) {
          if (abortControllerRef.current?.signal.aborted) break;
          assistantContent += chunk.text;
          if (chunk.groundingUrls && chunk.groundingUrls.length > 0) {
            groundingUrls = [...groundingUrls, ...chunk.groundingUrls];
          }

          setSessions(prev => prev.map(s => {
            if (s.id === activeSessionId) {
              return {
                ...s,
                messages: s.messages.map(m => 
                  m.id === assistantMessageId ? { 
                    ...m, 
                    content: assistantContent,
                    groundingUrls: groundingUrls.length > 0 ? Array.from(new Set(groundingUrls.map(u => JSON.stringify(u)))).map(s => JSON.parse(s)) : undefined
                  } : m
                )
              };
            }
            return s;
          }));
        }
      }

      // Mark as sent
      setSessions(prev => prev.map(s => {
        if (s.id === activeSessionId) {
          return {
            ...s,
            messages: s.messages.map(m => 
              m.id === assistantMessageId ? { ...m, status: 'sent' } : m
            )
          };
        }
        return s;
      }));

      // Generate a descriptive title if it's still the default
      const sessionToUpdate = updatedSessions.find(s => s.id === activeSessionId);
      if (sessionToUpdate && (sessionToUpdate.title === 'New Conversation' || sessionToUpdate.messages.length <= 2)) {
        const fullMessages = [...sessionToUpdate.messages, {
          id: assistantMessageId,
          role: 'model' as const,
          content: assistantContent,
          timestamp: Date.now()
        }];
        const newTitle = await gemini.generateTitle(fullMessages);
        setSessions(prev => prev.map(s => 
          s.id === activeSessionId ? { ...s, title: newTitle } : s
        ));
      }

    } catch (error: any) {
      console.error('Chat error:', error);
      const errorMessage = error?.message || "I encountered an error while processing your request. Please try again.";
      
      setSessions(prev => prev.map(s => {
        if (s.id === activeSessionId) {
          // If we were in the middle of a stream, mark the last message as error
          const lastMsg = s.messages[s.messages.length - 1];
          if (lastMsg && lastMsg.role === 'model') {
            return {
              ...s,
              messages: s.messages.map(m => 
                m.id === lastMsg.id ? { 
                  ...m, 
                  content: errorMessage,
                  error: true,
                  status: 'error'
                } : m
              )
            };
          }
        }
        return s;
      }));
    } finally {
      setIsLoading(false);
    }
  };

  const handleScroll = () => {
    if (chatContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;
      setShowScrollButton(!isAtBottom);
    }
  };

  return (
    <>
      <div className="flex h-screen bg-[#F5F5F3] overflow-hidden">
      {/* Sidebar */}
      <AnimatePresence mode="wait">
        {isSidebarOpen && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 300, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              className="bg-bg-secondary border-r border-border-subtle flex flex-col h-full overflow-hidden"
            >
              <div className="p-6 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-text-primary rounded-lg flex items-center justify-center">
                    <Sparkles className="w-5 h-5 text-bg-primary" />
                  </div>
                  <span className="font-serif italic text-xl font-semibold tracking-tight">Aura</span>
                </div>
                <button 
                  onClick={createNewSession}
                  className="p-2 hover:bg-text-primary/5 rounded-full transition-colors"
                  title="New Chat"
                >
                  <Plus className="w-5 h-5" />
                </button>
                {sessions.length > 0 && (
                  <button 
                    onClick={clearAllSessions}
                    className="p-2 hover:bg-red-500/10 text-text-secondary hover:text-red-500 rounded-full transition-colors"
                    title="Clear All History"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                )}
              </div>

              <div className="px-6 mb-4">
                <div className="relative group">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary group-focus-within:text-text-primary transition-colors" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search history..."
                    className="w-full bg-text-primary/5 border-none rounded-xl py-2 pl-10 pr-10 text-sm focus:ring-1 focus:ring-text-primary/10 placeholder:text-text-secondary"
                  />
                  {searchQuery && (
                    <button 
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 hover:bg-text-primary/10 rounded-full transition-colors"
                    >
                      <X className="w-3 h-3 text-text-secondary" />
                    </button>
                  )}
                </div>
              </div>

            <div className="flex-1 overflow-y-auto px-3 space-y-6">
              {sortedGroups.map(([group, groupSessions]) => (
                <div key={group} className="space-y-1">
                  <div className="px-3 mb-2">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-black/40">{group}</span>
                  </div>
                  {groupSessions.map(session => (
                    <div
                      key={session.id}
                      onClick={() => setCurrentSessionId(session.id)}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all group text-left cursor-pointer",
                        currentSessionId === session.id 
                          ? "bg-text-primary text-bg-primary shadow-lg shadow-text-primary/10" 
                          : "hover:bg-text-primary/5 text-text-secondary hover:text-text-primary"
                      )}
                    >
                      <MessageSquare className="w-4 h-4 shrink-0" />
                      {renamingSessionId === session.id ? (
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={() => saveRename(session.id)}
                          onKeyDown={(e) => e.key === 'Enter' && saveRename(session.id)}
                          className="flex-1 bg-transparent border-none p-0 text-sm font-medium focus:ring-0 text-inherit"
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span className="flex-1 truncate text-sm font-medium">{session.title}</span>
                      )}
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => startRenaming(session.id, session.title, e)}
                          className={cn(
                            "p-1 rounded-md transition-all opacity-0 group-hover:opacity-100 hover:bg-text-primary/10",
                            currentSessionId === session.id && "text-bg-primary/60 hover:text-bg-primary"
                          )}
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => togglePin(session.id, e)}
                          className={cn(
                            "p-1 rounded-md transition-all",
                            pinnedSessionIds.includes(session.id) 
                              ? "opacity-100 text-emerald-500" 
                              : "opacity-0 group-hover:opacity-100 hover:bg-text-primary/10"
                          )}
                        >
                          {pinnedSessionIds.includes(session.id) ? <Pin className="w-3 h-3 fill-current" /> : <Pin className="w-3 h-3" />}
                        </button>
                        <Trash2 
                          className={cn(
                            "w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity hover:text-red-500",
                            currentSessionId === session.id && "text-bg-primary/60 hover:text-bg-primary"
                          )} 
                          onClick={(e) => deleteSession(session.id, e)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            <div className="p-4 border-t border-border-subtle bg-bg-secondary/50 backdrop-blur-sm space-y-2">
              {deferredPrompt && (
                <button 
                  onClick={installPWA}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-xl bg-text-primary text-bg-primary hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg shadow-text-primary/10 group mb-2"
                >
                  <Download className="w-4 h-4" />
                  <span className="text-sm font-bold">Install App</span>
                </button>
              )}
              <button 
                onClick={toggleTheme}
                className="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-text-primary/5 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  {theme === 'light' ? <Moon className="w-4 h-4 text-text-secondary" /> : <Sun className="w-4 h-4 text-text-secondary" />}
                  <span className="text-sm font-medium text-text-secondary group-hover:text-text-primary">
                    {theme === 'light' ? 'Dark Mode' : 'Light Mode'}
                  </span>
                </div>
                <div className={cn(
                  "w-8 h-4 rounded-full relative transition-colors",
                  theme === 'dark' ? "bg-emerald-500" : "bg-text-primary/10"
                )}>
                  <div className={cn(
                    "absolute top-1 w-2 h-2 rounded-full bg-white transition-all",
                    theme === 'dark' ? "left-5" : "left-1"
                  )} />
                </div>
              </button>

              <div 
                onClick={() => user ? setIsSettingsOpen(true) : setIsAuthOpen(true)}
                className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-text-primary/5 transition-colors cursor-pointer group"
              >
                <div className="w-8 h-8 rounded-full bg-text-primary/10 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <UserIcon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{user ? user.email.split('@')[0] : 'Sign In'}</p>
                  <p className="text-[10px] text-text-secondary font-mono uppercase tracking-widest">
                    {user ? `${user.membership} Plan` : 'Sync Conversations'}
                  </p>
                </div>
                {user ? <Settings className="w-4 h-4 text-text-secondary" /> : <LogIn className="w-4 h-4 text-text-secondary" />}
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {isSettingsOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSettingsOpen(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="relative w-full max-w-md bg-bg-secondary border border-border-subtle rounded-[2.5rem] shadow-2xl overflow-hidden"
            >
              <div className="p-8 space-y-8">
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-serif italic font-bold">Settings</h2>
                  <button 
                    onClick={() => setIsSettingsOpen(false)}
                    className="p-2 hover:bg-text-primary/5 rounded-full transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="space-y-6">
                  <div className="space-y-4">
                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">Account</h3>
                    {user ? (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between p-4 bg-text-primary/5 rounded-2xl">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-text-primary/10 flex items-center justify-center">
                              <UserIcon className="w-5 h-5" />
                            </div>
                            <div>
                              <p className="text-sm font-bold">{user.email.split('@')[0]}</p>
                              <p className="text-xs text-text-secondary">{user.email}</p>
                            </div>
                          </div>
                          <span className={cn(
                            "px-2 py-1 text-[10px] font-bold rounded-md uppercase",
                            user.membership === 'pro' ? "bg-indigo-500/10 text-indigo-600" : "bg-emerald-500/10 text-emerald-600"
                          )}>
                            {user.membership}
                          </span>
                        </div>
                        {user.membership === 'free' && (
                          <button 
                            onClick={() => alert('Upgrade to Pro feature coming soon!')}
                            className="w-full flex items-center justify-center gap-3 p-4 bg-indigo-600 text-white rounded-2xl transition-all hover:scale-[1.02] active:scale-[0.98] font-bold shadow-xl shadow-indigo-600/20"
                          >
                            <Sparkles className="w-4 h-4" />
                            Upgrade to Pro
                          </button>
                        )}
                        <button 
                          onClick={handleLogout}
                          className="w-full flex items-center gap-3 p-4 hover:bg-red-500/10 text-red-500 rounded-2xl transition-colors text-sm font-bold"
                        >
                          <LogIn className="w-4 h-4 rotate-180" />
                          Sign Out
                        </button>
                      </div>
                    ) : (
                      <button 
                        onClick={() => {
                          setIsSettingsOpen(false);
                          setIsAuthOpen(true);
                        }}
                        className="w-full flex items-center justify-center gap-3 p-6 bg-text-primary text-bg-primary rounded-2xl transition-all hover:scale-[1.02] active:scale-[0.98] font-bold shadow-xl shadow-text-primary/10"
                      >
                        <LogIn className="w-5 h-5" />
                        Sign In to Sync
                      </button>
                    )}
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">Preferences</h3>
                    <div className="space-y-2">
                      <div className="space-y-2 p-4 bg-text-primary/5 rounded-2xl">
                        <div className="flex items-center gap-3 mb-2">
                          <Bot className="w-4 h-4 text-text-secondary" />
                          <span className="text-sm font-medium">Model Selection</span>
                        </div>
                        <select 
                          value={selectedModel}
                          onChange={(e) => setSelectedModel(e.target.value)}
                          className="w-full bg-bg-secondary border border-border-subtle rounded-xl p-3 text-xs focus:ring-1 focus:ring-text-primary/10"
                        >
                          <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro (Best Reasoning)</option>
                          <option value="gemini-3-flash-preview">Gemini 3 Flash (Fastest)</option>
                        </select>
                      </div>
                      <div className="space-y-2 p-4 bg-text-primary/5 rounded-2xl">
                        <div className="flex items-center gap-3 mb-2">
                          <Bot className="w-4 h-4 text-text-secondary" />
                          <span className="text-sm font-medium">System Instruction</span>
                        </div>
                        <textarea 
                          value={systemInstruction}
                          onChange={(e) => setSystemInstruction(e.target.value)}
                          className="w-full bg-bg-secondary border border-border-subtle rounded-xl p-3 text-xs focus:ring-1 focus:ring-text-primary/10 resize-none h-24"
                          placeholder="Customize how Aura behaves..."
                        />
                      </div>
                      <button 
                        onClick={toggleTheme}
                        className="w-full flex items-center justify-between p-4 hover:bg-text-primary/5 rounded-2xl transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
                          <span className="text-sm font-medium">Appearance</span>
                        </div>
                        <span className="text-xs text-text-secondary capitalize">{theme}</span>
                      </button>
                      <button 
                        onClick={toggleAutoSave}
                        className="w-full flex items-center justify-between p-4 hover:bg-text-primary/5 rounded-2xl transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <History className="w-4 h-4" />
                          <span className="text-sm font-medium">Auto-save History</span>
                        </div>
                        <div className={cn(
                          "w-8 h-4 rounded-full relative transition-colors",
                          autoSaveHistory ? "bg-emerald-500" : "bg-text-primary/10"
                        )}>
                          <div className={cn(
                            "absolute top-1 w-2 h-2 rounded-full bg-white transition-all",
                            autoSaveHistory ? "left-5" : "left-1"
                          )} />
                        </div>
                      </button>
                      
                      <div className="pt-4 border-t border-border-subtle">
                        <h3 className="text-[10px] font-bold uppercase tracking-widest text-text-secondary mb-4">App Status</h3>
                        <div className="p-4 bg-emerald-500/5 border border-emerald-500/10 rounded-2xl space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                              <span className="text-xs font-bold text-emerald-600 uppercase tracking-widest">PWA Ready</span>
                            </div>
                            <span className="text-[10px] font-mono text-emerald-600/60">v1.0.0</span>
                          </div>
                          <p className="text-[11px] text-text-secondary leading-relaxed">
                            Aura is a Progressive Web App. You can install it on your home screen for an app-like experience.
                          </p>
                          {deferredPrompt && (
                            <button 
                              onClick={installPWA}
                              className="w-full py-3 bg-emerald-500 text-white rounded-xl text-xs font-bold hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20"
                            >
                              Install Aura Now
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pt-4">
                  <button 
                    onClick={clearAllSessions}
                    className="w-full py-4 bg-red-500 text-white rounded-2xl font-bold text-sm hover:bg-red-600 transition-colors shadow-lg shadow-red-500/20"
                  >
                    Delete All Conversations
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative bg-bg-primary">
        {/* Header */}
        <header className="h-20 flex items-center justify-between px-8 bg-bg-primary/80 backdrop-blur-xl sticky top-0 z-30 border-b border-border-subtle">
          <div className="flex items-center gap-6">
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2.5 hover:bg-text-primary/5 rounded-xl transition-all duration-300 hover:scale-110 active:scale-95 text-text-secondary hover:text-text-primary"
            >
              <ChevronLeft className={cn("w-5 h-5 transition-transform duration-500", !isSidebarOpen && "rotate-180")} />
            </button>
            <div className="flex flex-col">
              <h2 className="text-sm font-serif italic font-bold tracking-tight text-text-primary truncate max-w-[200px] md:max-w-[400px]">
                {currentSession?.title || 'New Conversation'}
              </h2>
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                <span className="text-[9px] font-bold uppercase tracking-widest text-text-secondary opacity-60">
                  {isSyncing ? 'Syncing...' : 'Encrypted & Secure'}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {currentSession && currentSession.messages.length > 0 && (
              <div className="flex items-center gap-1.5 bg-text-primary/5 p-1 rounded-xl border border-text-primary/5">
                <button 
                  onClick={clearCurrentChat}
                  className="p-2 hover:bg-red-500/10 rounded-lg transition-all text-text-secondary hover:text-red-500 hover:scale-105 active:scale-95"
                  title="Clear Chat"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <div className="w-px h-4 bg-text-primary/10 mx-1" />
                <button 
                  onClick={copyAllMessages}
                  className="p-2 hover:bg-text-primary/10 rounded-lg transition-all text-text-secondary hover:text-text-primary hover:scale-105 active:scale-95"
                  title="Copy All"
                >
                  <Copy className="w-4 h-4" />
                </button>
                <button 
                  onClick={exportToJson}
                  className="p-2 hover:bg-text-primary/10 rounded-lg transition-all text-text-secondary hover:text-text-primary hover:scale-105 active:scale-95"
                  title="Export JSON"
                >
                  <Code className="w-4 h-4" />
                </button>
                <button 
                  onClick={downloadConversation}
                  className="p-2 hover:bg-text-primary/10 rounded-lg transition-all text-text-secondary hover:text-text-primary hover:scale-105 active:scale-95"
                  title="Download TXT"
                >
                  <Download className="w-4 h-4" />
                </button>
              </div>
            )}
            <button 
              onClick={() => setIsSettingsOpen(true)}
              className="p-2.5 hover:bg-text-primary/5 rounded-xl transition-all duration-300 hover:scale-110 active:scale-95 text-text-secondary hover:text-text-primary"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Chat Area */}
        <div 
          ref={chatContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-6 py-12 space-y-16 max-w-4xl mx-auto w-full scroll-smooth relative"
        >
          {currentSession?.messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-16 py-12">
              <motion.div 
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1] }}
                className="space-y-8"
              >
                <div className="w-24 h-24 bg-text-primary rounded-[3rem] flex items-center justify-center shadow-2xl shadow-text-primary/20 mx-auto rotate-3 hover:rotate-0 transition-transform duration-500">
                  <Sparkles className="w-12 h-12 text-bg-primary" />
                </div>
                <div className="space-y-4">
                  <h1 className="text-6xl font-serif italic font-bold tracking-tight text-text-primary">
                    How can I help you today?
                  </h1>
                  <p className="text-text-secondary text-xl max-w-lg mx-auto font-medium opacity-60 leading-relaxed">
                    Aura is your creative partner for writing, coding, and exploring new ideas.
                  </p>
                </div>
              </motion.div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-2xl">
                {[
                  {
                    icon: <Code className="w-4 h-4 text-indigo-500" />,
                    title: "Programming",
                    description: "Write a React component for a dashboard",
                    prompt: "Can you write a React component for a clean, modern dashboard using Tailwind CSS?"
                  },
                  {
                    icon: <PenTool className="w-4 h-4 text-emerald-500" />,
                    title: "Writing",
                    description: "Help me draft a professional email",
                    prompt: "I need to draft a professional email to a client explaining a project delay. Can you help?"
                  },
                  {
                    icon: <Compass className="w-4 h-4 text-orange-500" />,
                    title: "Planning",
                    description: "Healthy dinner ideas for the week",
                    prompt: "What are 5 healthy and quick dinner ideas for a busy work week?"
                  },
                  {
                    icon: <Lightbulb className="w-4 h-4 text-amber-500" />,
                    title: "Brainstorming",
                    description: "Explain quantum computing simply",
                    prompt: "Explain quantum computing to me like I'm five years old."
                  }
                ].map((suggestion, index) => (
                  <motion.button
                    key={suggestion.title}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                    onClick={() => {
                      handleSend(suggestion.prompt);
                    }}
                    className="group p-5 text-left bg-white border border-border-subtle rounded-[2rem] hover:border-text-primary/20 hover:shadow-xl hover:shadow-text-primary/5 transition-all duration-300"
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <div className="p-2 bg-bg-secondary rounded-xl group-hover:scale-110 transition-transform">
                        {suggestion.icon}
                      </div>
                      <span className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">
                        {suggestion.title}
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-text-primary leading-relaxed">
                      {suggestion.description}
                    </p>
                  </motion.button>
                ))}
              </div>
            </div>
          )}

          {currentSession?.messages.map((message, idx) => (
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
              key={message.id}
              className={cn(
                "flex gap-8 group w-full",
                message.role === 'user' ? "flex-row-reverse" : "flex-row"
              )}
            >
              <div className={cn(
                "w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 mt-1 transition-all duration-500",
                message.role === 'user' 
                  ? "bg-text-primary text-bg-primary shadow-xl shadow-text-primary/10 group-hover:scale-110 group-hover:rotate-3" 
                  : "bg-white border border-border-subtle shadow-sm group-hover:scale-110 group-hover:-rotate-3"
              )}>
                {message.role === 'user' ? <UserIcon className="w-6 h-6" /> : <Bot className="w-6 h-6" />}
              </div>
              <div className={cn(
                "max-w-[85%] space-y-3",
                message.role === 'user' ? "items-end" : "items-start"
              )}>
                <div className={cn(
                  "p-8 rounded-[2.5rem] shadow-sm relative group/msg transition-all duration-500",
                  message.role === 'user' 
                    ? "bg-text-primary text-bg-primary rounded-tr-none shadow-text-primary/5" 
                    : message.error
                      ? "bg-red-500/5 border border-red-500/20 text-red-600 rounded-tl-none"
                      : "bg-white border border-border-subtle rounded-tl-none hover:shadow-xl hover:shadow-black/5"
                )}>
                  {message.imageUrl && (
                    <div className="mb-4 rounded-2xl overflow-hidden border border-black/5 shadow-xl">
                      <img 
                        src={message.imageUrl} 
                        alt={message.type === 'image' ? "Generated AI image" : "Uploaded content"} 
                        className="max-w-full h-auto object-cover hover:scale-105 transition-transform duration-500"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                  )}
                  {message.error && (
                    <div className="flex items-center gap-2 mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-red-500">
                      <AlertCircle className="w-3.5 h-3.5" />
                      <span>System Error</span>
                    </div>
                  )}
                  <div className={cn(
                    "markdown-body prose prose-sm max-w-none",
                    message.role === 'user' ? "prose-invert" : ""
                  )}>
                    <Markdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        pre: ({ children }) => {
                          const codeText = React.Children.toArray(children)
                            .map((child: any) => child.props?.children || child)
                            .join('');
                          return (
                            <div className="relative group/code my-4">
                              <CopyButton text={codeText} />
                              <pre className="!bg-bg-secondary !p-4 !rounded-2xl !border !border-border-subtle !m-0 overflow-x-auto">
                                {children}
                              </pre>
                            </div>
                          );
                        },
                        code: ({ node, inline, className, children, ...props }: any) => {
                          return inline ? (
                            <code className="bg-text-primary/5 px-1.5 py-0.5 rounded-md font-mono text-xs" {...props}>
                              {children}
                            </code>
                          ) : (
                            <code className={className} {...props}>
                              {children}
                            </code>
                          );
                        }
                      }}
                    >
                      {message.content}
                    </Markdown>
                  </div>

                  {message.groundingUrls && message.groundingUrls.length > 0 && (
                    <div className="mt-6 pt-6 border-t border-text-primary/5 space-y-3">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-text-secondary opacity-50">Verified Sources</p>
                      <div className="flex flex-wrap gap-2">
                        {message.groundingUrls.map((url, idx) => (
                          <a 
                            key={idx}
                            href={url.uri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 px-3 py-1.5 bg-text-primary/5 hover:bg-text-primary/10 rounded-full text-[10px] font-semibold text-text-primary transition-all duration-300 border border-text-primary/5 hover:scale-105"
                          >
                            <ExternalLink className="w-3 h-3" />
                            <span className="truncate max-w-[150px]">{url.title}</span>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className={cn(
                    "mt-4 pt-4 border-t flex items-center gap-3 opacity-100 md:opacity-0 md:group-hover/msg:opacity-100 transition-opacity duration-300",
                    message.role === 'user' ? "border-bg-primary/10 justify-end" : "border-text-primary/10 justify-start"
                  )}>
                    {!message.error && (
                      <button
                        onClick={() => handleSpeak(message.id, message.content)}
                        className={cn(
                          "flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all",
                          message.role === 'user' 
                            ? "text-bg-primary/40 hover:bg-bg-primary/10 hover:text-bg-primary" 
                            : "text-text-secondary hover:bg-text-primary/5 hover:text-text-primary",
                          isSpeaking === message.id && "bg-emerald-500/10 text-emerald-600 opacity-100"
                        )}
                      >
                        <Volume2 className={cn("w-3.5 h-3.5", isSpeaking === message.id && "animate-pulse")} />
                        <span>{isSpeaking === message.id ? "Stop" : "Listen"}</span>
                      </button>
                    )}
                    {!message.error && (
                      <button
                        onClick={() => handleQuote(message.content)}
                        className={cn(
                          "flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all",
                          message.role === 'user' 
                            ? "text-bg-primary/40 hover:bg-bg-primary/10 hover:text-bg-primary" 
                            : "text-text-secondary hover:bg-text-primary/5 hover:text-text-primary"
                        )}
                      >
                        <Quote className="w-3.5 h-3.5" />
                        <span>Quote</span>
                      </button>
                    )}
                    {!message.error && (
                      <button
                        onClick={() => handleCopyMessage(message.id, message.content)}
                        className={cn(
                          "flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all",
                          message.role === 'user' 
                            ? "text-bg-primary/40 hover:bg-bg-primary/10 hover:text-bg-primary" 
                            : "text-text-secondary hover:bg-text-primary/5 hover:text-text-primary",
                          copiedMessageId === message.id && "text-emerald-500 bg-emerald-500/10 opacity-100"
                        )}
                      >
                        {copiedMessageId === message.id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedMessageId === message.id ? "Copied" : "Copy"}</span>
                      </button>
                    )}
                    {message.role === 'user' && (
                      <button
                        onClick={() => handleEdit(message.id, message.content)}
                        className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all text-bg-primary/40 hover:bg-bg-primary/10 hover:text-bg-primary"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        <span>Edit</span>
                      </button>
                    )}
                    {message.error && (
                      <button
                        onClick={() => handleRetry(message.id)}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all bg-red-500 text-white hover:bg-red-600 shadow-lg shadow-red-500/20"
                      >
                        <RefreshCcw className="w-3.5 h-3.5" />
                        <span>Retry Request</span>
                      </button>
                    )}
                    {!message.error && message.role === 'model' && currentSession?.messages[currentSession.messages.length - 1]?.id === message.id && (
                      <button
                        onClick={handleRegenerate}
                        className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all text-text-secondary hover:bg-text-primary/5 hover:text-text-primary"
                      >
                        <RefreshCcw className="w-3.5 h-3.5" />
                        <span>Regenerate</span>
                      </button>
                    )}
                    <button
                      onClick={() => deleteMessage(message.id)}
                      className={cn(
                        "flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all",
                        message.role === 'user' 
                          ? "text-bg-primary/40 hover:bg-bg-primary/10 hover:text-bg-primary" 
                          : "text-text-secondary hover:bg-red-500/10 hover:text-red-500"
                      )}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete</span>
                    </button>
                  </div>
                </div>
                <span className="text-[10px] text-text-secondary font-mono px-2 opacity-50">
                  {format(message.timestamp, 'HH:mm')}
                </span>
              </div>
            </motion.div>
          ))}
          {isLoading && currentSession?.messages[currentSession.messages.length - 1]?.role === 'user' && (
            <div className="flex gap-4">
              <div className="w-8 h-8 rounded-lg bg-bg-secondary border border-border-subtle shadow-sm flex items-center justify-center shrink-0 mt-1">
                <Bot className="w-4 h-4" />
              </div>
              <div className="bg-bg-secondary border border-border-subtle p-4 rounded-2xl rounded-tl-none shadow-sm">
                <div className="flex gap-1">
                  <div className="w-1.5 h-1.5 bg-text-primary/20 rounded-full animate-bounce [animation-delay:-0.3s]" />
                  <div className="w-1.5 h-1.5 bg-text-primary/20 rounded-full animate-bounce [animation-delay:-0.15s]" />
                  <div className="w-1.5 h-1.5 bg-text-primary/20 rounded-full animate-bounce" />
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Scroll to bottom button */}
        <AnimatePresence>
          {showScrollButton && (
            <motion.button
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              onClick={() => scrollToBottom('smooth')}
              className="fixed bottom-32 right-8 p-3 bg-bg-secondary border border-border-subtle rounded-full shadow-xl hover:bg-text-primary/5 transition-all z-20"
              title="Scroll to bottom"
            >
              <ChevronDown className="w-5 h-5" />
            </motion.button>
          )}
        </AnimatePresence>

        {/* Input Area */}
        <div className="p-8 bg-gradient-to-t from-bg-primary via-bg-primary/95 to-transparent sticky bottom-0 z-20">
          <div className="max-w-4xl mx-auto space-y-6">
            <AnimatePresence>
              {editingMessageId && (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 20 }}
                  className="flex items-center justify-between p-4 bg-text-primary/5 backdrop-blur-xl rounded-t-[2.5rem] border border-border-subtle border-b-0"
                >
                  <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-[0.2em] text-text-secondary pl-4">
                    <Pencil className="w-4 h-4" />
                    <span>Editing message...</span>
                  </div>
                  <button 
                    onClick={cancelEdit}
                    className="p-2 hover:bg-text-primary/10 rounded-full transition-all hover:scale-110 active:scale-90 mr-2"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {selectedImage && (
                <motion.div 
                  initial={{ opacity: 0, y: 20, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 20, scale: 0.95 }}
                  className="flex items-center gap-4 p-3 bg-white border border-border-subtle rounded-2xl shadow-xl w-fit"
                >
                  <div className="relative w-16 h-16 rounded-xl overflow-hidden shadow-inner bg-bg-secondary">
                    <img src={selectedImage} alt="Preview" className="w-full h-full object-cover" />
                    <button 
                      onClick={() => setSelectedImage(null)}
                      className="absolute top-1 right-1 p-1 bg-black/50 text-white rounded-full hover:bg-black/70 transition-all hover:scale-110 active:scale-90"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="pr-4">
                    <p className="text-xs font-bold uppercase tracking-widest text-text-primary">Image Attached</p>
                    <p className="text-[10px] text-text-secondary font-medium">Ready for analysis</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className={cn(
              "relative flex flex-col bg-white border border-border-subtle shadow-2xl shadow-black/5 transition-all duration-500 overflow-hidden",
              editingMessageId ? "rounded-b-[2.5rem] rounded-t-none border-t-0" : "rounded-[2.5rem] focus-within:shadow-xl focus-within:shadow-black/10 focus-within:-translate-y-1"
            )}>
              <div className="flex items-center gap-4 px-8 py-4 border-b border-border-subtle bg-bg-primary/30">
                <button
                  onClick={() => setUseSearch(!useSearch)}
                  className={cn(
                    "flex items-center gap-2.5 px-4 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all duration-500",
                    useSearch 
                      ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/30 scale-105" 
                      : "bg-text-primary/5 text-text-secondary hover:bg-text-primary/10"
                  )}
                >
                  <Globe className="w-4 h-4" />
                  <span>Search</span>
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2.5 px-4 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest bg-text-primary/5 text-text-secondary hover:bg-text-primary/10 transition-all duration-500"
                >
                  <Paperclip className="w-4 h-4" />
                  <span>Attach</span>
                </button>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleImageUpload} 
                  accept="image/*" 
                  className="hidden" 
                />
                <div className="h-5 w-px bg-border-subtle mx-2" />
                <div className="flex items-center gap-2.5 px-4 py-2 bg-text-primary/5 rounded-full text-[10px] font-mono text-text-secondary opacity-50">
                  <Keyboard className="w-4 h-4" />
                  <span>Cmd+Enter</span>
                </div>
              </div>

              <div className="flex items-end gap-6 p-6 pl-8">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Message Aura..."
                  className="flex-1 max-h-64 min-h-[56px] py-4 bg-transparent border-none focus:ring-0 resize-none text-lg placeholder:text-text-secondary/40 leading-relaxed"
                  rows={1}
                />
                <div className="flex items-center gap-3 pb-2 pr-2">
                  {isLoading && (
                    <button
                      onClick={stopStreaming}
                      className="p-4 rounded-2xl transition-all duration-300 hover:bg-red-500/10 text-red-500 hover:scale-110 active:scale-90"
                      title="Stop generating"
                    >
                      <X className="w-7 h-7" />
                    </button>
                  )}
                  <button
                    onClick={handleGenerateImage}
                    disabled={!input.trim() || isLoading}
                    className={cn(
                      "p-4 rounded-2xl transition-all duration-300",
                      input.trim() && !isLoading 
                        ? "hover:bg-text-primary/5 text-text-primary hover:scale-110 active:scale-90" 
                        : "text-text-secondary/20"
                    )}
                    title="Generate Image"
                  >
                    <ImageIcon className={cn("w-7 h-7", isGeneratingImage && "animate-spin")} />
                  </button>
                  <button
                    onClick={toggleListening}
                    className={cn(
                      "p-4 rounded-2xl transition-all duration-300",
                      isListening 
                        ? "bg-red-500 text-white animate-pulse shadow-lg shadow-red-500/30" 
                        : "hover:bg-text-primary/5 text-text-secondary hover:scale-110 active:scale-90"
                    )}
                  >
                    {isListening ? <MicOff className="w-7 h-7" /> : <Mic className="w-7 h-7" />}
                  </button>
                  <button
                    onClick={() => handleSend()}
                    disabled={(!input.trim() && !selectedImage) || isLoading}
                    className={cn(
                      "p-4 rounded-2xl transition-all duration-500 shadow-xl",
                      (input.trim() || selectedImage) && !isLoading 
                        ? "bg-text-primary text-bg-primary hover:scale-110 active:scale-95 shadow-text-primary/20" 
                        : "bg-text-primary/5 text-text-secondary/30 shadow-none"
                    )}
                  >
                    <Send className="w-7 h-7" />
                  </button>
                </div>
              </div>
            </div>
            <p className="text-center text-[10px] text-text-secondary/40 font-bold uppercase tracking-[0.2em]">
              Aura can make mistakes. Verify important info.
            </p>
          </div>
        </div>
      </main>
    </div>

    <AnimatePresence>
      {isAuthOpen && (
        <Auth 
          onAuthSuccess={handleAuthSuccess} 
          onClose={() => setIsAuthOpen(false)} 
        />
      )}
    </AnimatePresence>
    </>
  );
}
