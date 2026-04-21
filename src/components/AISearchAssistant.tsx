import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, X, Send, Bot, User, Loader2, Search } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  db,
  auth,
  handleFirestoreError,
  FirestoreOperationType,
  orderBy,
  limit
} from '../firebase';
import { UserProfile, Communication, Student, Authorization } from '../types';
import { askAISearch } from '../services/geminiService';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface AISearchAssistantProps {
  user: UserProfile;
}

export const AISearchAssistant: React.FC<AISearchAssistantProps> = ({ user }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [queryText, setQueryText] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [context, setContext] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Context data states
  const [students, setStudents] = useState<Student[]>([]);
  const [comms, setComms] = useState<Communication[]>([]);
  const [auths, setAuths] = useState<Authorization[]>([]);

  useEffect(() => {
    const schoolId = user.schoolId || 'default-school';
    if (!schoolId || !auth.currentUser) return;

    // Fetch context data
    const qStudents = user.role === 'parent'
      ? query(collection(db, 'students'), where('parentId', '==', user.uid))
      : query(collection(db, 'students'), where('schoolId', '==', schoolId));
    
    const unsubStudents = onSnapshot(qStudents, (snap) => {
      setStudents(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Student)));
    }, (error) => handleFirestoreError(error, FirestoreOperationType.LIST, 'students'));

    const qComms = query(collection(db, 'communications'), where('schoolId', '==', schoolId));
    const unsubComms = onSnapshot(qComms, (snap) => {
      const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Communication));
      // Sort and limit in memory to avoid index requirements
      setComms(data.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 20));
    }, (error) => handleFirestoreError(error, FirestoreOperationType.LIST, 'communications'));

    const qAuths = user.role === 'parent' 
      ? query(collection(db, 'authorizations'), where('parentId', '==', user.uid))
      : query(collection(db, 'authorizations'), where('schoolId', '==', schoolId));
    
    const unsubAuths = onSnapshot(qAuths, (snap) => {
      const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Authorization));
      setAuths(data.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 10));
    }, (error) => handleFirestoreError(error, FirestoreOperationType.LIST, 'authorizations'));

    return () => {
      unsubStudents();
      unsubComms();
      unsubAuths();
    };
  }, [user.schoolId, user.uid, user.role, auth.currentUser]);

  // Update context string whenever data changes
  useEffect(() => {
    const contextStr = `
      Usuario actual: ${user.name} (${user.role})
      Estudiantes: ${students.map(s => `${s.name} (Grado: ${s.grade || 'N/A'}, Clase: ${s.class || 'N/A'})`).join(', ')}
      Comunicados: ${comms.map(c => `${c.title}: ${c.content} (Fecha: ${c.date})`).join(' | ')}
      Autorizaciones activas: ${auths.map(a => `Para ${students.find(s => s.id === a.studentId)?.name || 'alumno'} a favor de ${a.authorizedPersonName} (Estado: ${a.status})`).join(' | ')}
    `;
    setContext(contextStr);
  }, [students, comms, auths, user.name, user.role]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    if (!queryText.trim() || isLoading) return;

    const userMessage: Message = {
      id: `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      role: 'user',
      content: queryText,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setQueryText('');
    setIsLoading(true);

    try {
      const aiResponse = await askAISearch(queryText, context);
      const assistantMessage: Message = {
        id: `assistant-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        role: 'assistant',
        content: aiResponse,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error("AI Error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      {/* Floating Button */}
      <motion.button
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-indigo-600 text-white rounded-full shadow-2xl flex items-center justify-center z-40 hover:bg-indigo-700 transition-colors"
        id="ai-assistant-trigger"
      >
        <Sparkles size={24} />
      </motion.button>

      {/* Chat Window */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20, x: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0, x: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20, x: 20 }}
            className="fixed bottom-24 right-6 w-[90vw] sm:w-96 h-[600px] max-h-[70vh] bg-white rounded-3xl shadow-2xl border border-slate-200 flex flex-col z-50 overflow-hidden"
            id="ai-assistant-window"
          >
            {/* Header */}
            <div className="bg-indigo-600 p-4 text-white flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">
                  <Bot size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-sm">Asistente Nexo</h3>
                  <p className="text-[10px] opacity-80">IA con contexto escolar</p>
                </div>
              </div>
              <button onClick={() => setIsOpen(false)} className="p-1 hover:bg-white/10 rounded-lg transition-colors">
                <X size={20} />
              </button>
            </div>

            {/* Messages */}
            <div 
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50"
            >
              {messages.length === 0 && (
                <div className="text-center py-10 space-y-4">
                  <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center mx-auto">
                    <Sparkles size={32} />
                  </div>
                  <div>
                    <p className="font-bold text-slate-900">¿En qué puedo ayudarte hoy?</p>
                    <p className="text-xs text-slate-500 max-w-[200px] mx-auto mt-1">
                      Pregúntame sobre comunicados, alumnos o autorizaciones.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-2 px-4">
                    {[
                      "¿Qué comunicados hay hoy?",
                      "¿Quién está autorizado para retirar a mi hijo?",
                      "Resúmeme los eventos importantes",
                      "¿Cuántos alumnos hay en 1er grado?"
                    ].map((suggestion, i) => (
                      <button
                        key={i}
                        onClick={() => setQueryText(suggestion)}
                        className="text-left p-3 bg-white border border-slate-200 rounded-xl text-xs text-slate-600 hover:border-indigo-300 hover:bg-indigo-50 transition-all"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`flex gap-2 max-w-[85%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-indigo-100 text-indigo-600' : 'bg-white border border-slate-200 text-slate-600'}`}>
                      {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                    </div>
                    <div className={`p-3 rounded-2xl text-sm ${
                      msg.role === 'user' 
                        ? 'bg-indigo-600 text-white rounded-tr-none' 
                        : 'bg-white border border-slate-200 text-slate-700 rounded-tl-none shadow-sm'
                    }`}>
                      <div className="prose prose-sm prose-slate max-w-none">
                        <Markdown>{msg.content}</Markdown>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="flex gap-2 max-w-[85%]">
                    <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-600 flex items-center justify-center">
                      <Bot size={16} />
                    </div>
                    <div className="p-3 rounded-2xl bg-white border border-slate-200 text-slate-400 rounded-tl-none shadow-sm flex items-center gap-2">
                      <Loader2 size={16} className="animate-spin" />
                      <span className="text-xs">Pensando...</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Input */}
            <div className="p-4 bg-white border-t border-slate-200">
              <div className="relative">
                <input
                  type="text"
                  value={queryText}
                  onChange={(e) => setQueryText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                  placeholder="Escribe tu pregunta..."
                  className="w-full pl-4 pr-12 py-3 bg-slate-100 border-none rounded-2xl text-sm focus:ring-2 focus:ring-indigo-500/20 transition-all"
                />
                <button
                  onClick={handleSend}
                  disabled={!queryText.trim() || isLoading}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-indigo-600 text-white rounded-xl flex items-center justify-center disabled:opacity-50 disabled:bg-slate-400 transition-all"
                >
                  <Send size={16} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
