import { AISearchAssistant } from './components/AISearchAssistant';
import { QRScannerModal } from './components/QRScannerModal';
import { Button } from './components/ui/Button';
import { Card } from './components/ui/Card';
import { Badge } from './components/ui/Badge';
import React, { useState, useEffect, createContext, useContext, useRef } from 'react';
import { 
  Bell, 
  Calendar as CalendarIcon, 
  CheckCircle, 
  ChevronRight, 
  Clock, 
  FileText, 
  Home, 
  Inbox, 
  LogOut, 
  Menu, 
  Plus, 
  QrCode, 
  Scan, 
  Search, 
  Shield, 
  Star, 
  User, 
  Users, 
  X,
  BookOpen,
  Camera,
  AlertCircle,
  Info,
  Moon,
  Sun,
  Activity,
  Settings,
  Database,
  Lock,
  Eye,
  EyeOff,
  Trash2,
  Edit
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { QRCodeSVG } from 'qrcode.react';
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  doc, 
  getDoc, 
  getDocs,
  setDoc, 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc,
  handleFirestoreError,
  FirestoreOperationType
} from './firebase';
import { UserProfile, Communication, Authorization, Student, School } from './types';
import { summarizeCommunication } from './services/geminiService';

const addToCalendar = (comm: Communication) => {
  const title = encodeURIComponent(comm.title);
  const details = encodeURIComponent(comm.content);
  const location = encodeURIComponent(comm.location || '');
  const startDate = new Date(comm.deadline || comm.date);
  const endDate = new Date(startDate.getTime() + 60 * 60 * 1000); // Default 1 hour
  
  const formatGoogleDate = (d: Date) => d.toISOString().replace(/-|:|\.\d+/g, '');
  const dates = `${formatGoogleDate(startDate)}/${formatGoogleDate(endDate)}`;
  
  const googleUrl = `https://www.google.com/calendar/render?action=TEMPLATE&text=${title}&details=${details}&location=${location}&dates=${dates}`;
  window.open(googleUrl, '_blank');
};

// --- Contexts ---

interface AuthContextType {
  user: UserProfile | null;
  loading: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  setGuestUser: (role: 'parent' | 'school' | 'admin') => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};

const mockUsers: Record<string, UserProfile> = {
  parent: {
    uid: 'guest-parent',
    email: 'parent@example.com',
    name: 'Padre Invitado',
    role: 'parent',
    schoolId: 'default-school'
  },
  school: {
    uid: 'guest-school',
    email: 'school@example.com',
    name: 'Colegio Invitado',
    role: 'school',
    schoolId: 'default-school'
  },
  admin: {
    uid: 'guest-admin',
    email: 'admin@example.com',
    name: 'Administrador Invitado',
    role: 'admin'
  }
};

// --- Components ---

const Logo = ({ size = 40, className = "" }: { size?: number, className?: string }) => (
  <div 
    className={`flex items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 shadow-lg ${className}`} 
    style={{ width: size, height: size }}
  >
    <div className="relative">
      <Activity className="text-white animate-pulse" size={size * 0.6} strokeWidth={2.5} />
      <div className="absolute -top-1 -right-1 w-2 h-2 bg-emerald-400 rounded-full border-2 border-indigo-600" />
    </div>
  </div>
);

const ThemeToggle = () => {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDark]);

  return (
    <Button variant="ghost" onClick={() => setIsDark(!isDark)} className="p-2">
      {isDark ? <Sun size={20} /> : <Moon size={20} />}
    </Button>
  );
};

const NotificationToggle = () => {
  const { permission, requestPermission, addNotification } = useNotifications();

  const handleToggle = async () => {
    if (permission === 'default') {
      const granted = await requestPermission();
      if (granted) {
        addNotification({
          title: 'Notificaciones activadas',
          content: 'Ahora recibirás avisos urgentes directamente en tu dispositivo.',
          category: 'success',
          isImportant: false
        });
      }
    } else if (permission === 'denied') {
      alert("Para activar las notificaciones, por favor habilita los permisos en la configuración de tu navegador para este sitio.");
    }
  };

  if (permission === 'granted') return null;

  return (
    <Button 
      variant="ghost" 
      onClick={handleToggle} 
      className="p-2 text-amber-500 hover:text-amber-600 hover:bg-amber-50"
      title="Activar Notificaciones"
    >
      <Bell size={20} className="animate-pulse" />
    </Button>
  );
};

// --- Notification System ---

interface AppNotification {
  id: string;
  title: string;
  content: string;
  category: 'event' | 'urgent' | 'info' | 'success' | 'message';
  isImportant: boolean;
  date: string;
  read: boolean;
}

const NotificationContext = createContext<{
  notifications: AppNotification[];
  addNotification: (n: Omit<AppNotification, 'id' | 'read' | 'date'>) => void;
  markAsRead: (id: string) => void;
  unreadCount: number;
  requestPermission: () => Promise<boolean>;
  permission: NotificationPermission;
} | null>(null);

const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (!context) throw new Error('useNotifications must be used within NotificationProvider');
  return context;
};

const NotificationProvider = ({ children }: { children: React.ReactNode }) => {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  );

  const requestPermission = async () => {
    if (typeof Notification === 'undefined') return false;
    const result = await Notification.requestPermission();
    setPermission(result);
    return result === 'granted';
  };

  const addNotification = (n: Omit<AppNotification, 'id' | 'read' | 'date'>) => {
    const newNotification: AppNotification = {
      ...n,
      id: Math.random().toString(36).substr(2, 9),
      date: new Date().toISOString(),
      read: false
    };
    setNotifications(prev => [newNotification, ...prev]);
    
    // Native Browser Notification
    if (permission === 'granted' && typeof Notification !== 'undefined') {
      try {
        new Notification(n.title, {
          body: n.content,
          icon: '/favicon.ico',
        });
      } catch (e) {
        console.error("Error showing native notification:", e);
      }
    }

    // Simulate push notification sound or visual alert
    if (n.category === 'urgent' || n.isImportant) {
      console.log("PRIORITY NOTIFICATION:", n.title);
      // Play a subtle sound if possible
      try {
        const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
        audio.volume = 0.5;
        audio.play().catch(() => {}); // Ignore interaction errors
      } catch (e) {}
    }
  };

  const markAsRead = (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <NotificationContext.Provider value={{ notifications, addNotification, markAsRead, unreadCount, requestPermission, permission }}>
      {children}
      <NotificationCenter />
    </NotificationContext.Provider>
  );
};

const NotificationCenter = () => {
  const { notifications, markAsRead } = useNotifications();
  const [activeNotification, setActiveNotification] = useState<AppNotification | null>(null);

  useEffect(() => {
    const unreadNotifications = notifications.filter(n => !n.read);
    if (unreadNotifications.length === 0) {
      setActiveNotification(null);
      return;
    }

    // Prioritize urgent/important, then by date
    const sorted = [...unreadNotifications].sort((a, b) => {
      const aUrgent = a.category === 'urgent' || a.isImportant;
      const bUrgent = b.category === 'urgent' || b.isImportant;
      if (aUrgent && !bUrgent) return -1;
      if (!aUrgent && bUrgent) return 1;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });

    setActiveNotification(sorted[0]);
  }, [notifications]);

  if (!activeNotification) return null;

  return (
    <AnimatePresence>
      <motion.div 
        key={activeNotification.id}
        initial={{ opacity: 0, y: 50, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        className="fixed bottom-6 left-6 right-6 z-50 sm:left-auto sm:right-6 sm:w-96"
      >
        <Card className={`border-2 ${activeNotification.category === 'urgent' ? 'border-rose-500 bg-rose-50' : activeNotification.category === 'success' ? 'border-emerald-500 bg-emerald-50' : 'border-indigo-500 bg-indigo-50'} shadow-2xl`}>
          <div className="flex items-start gap-4">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${activeNotification.category === 'urgent' ? 'bg-rose-100 text-rose-600' : activeNotification.category === 'success' ? 'bg-emerald-100 text-emerald-600' : 'bg-indigo-100 text-indigo-600'}`}>
              {activeNotification.category === 'message' ? <Inbox size={24} /> : <Bell className={activeNotification.category === 'urgent' ? 'animate-bell' : ''} size={24} />}
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <span className={`text-[10px] font-bold uppercase tracking-widest ${activeNotification.category === 'urgent' ? 'text-rose-600' : activeNotification.category === 'success' ? 'text-emerald-600' : 'text-indigo-600'}`}>
                  {activeNotification.category === 'urgent' ? 'Urgente' : activeNotification.category === 'message' ? 'Mensaje' : activeNotification.category === 'success' ? 'Éxito' : 'Importante'}
                </span>
                <button onClick={() => { markAsRead(activeNotification.id); setActiveNotification(null); }} className="text-slate-400 hover:text-slate-600">
                  <X size={16} />
                </button>
              </div>
              <h4 className="font-bold text-slate-900 mb-1">{activeNotification.title}</h4>
              <p className="text-sm text-slate-600 line-clamp-2 mb-3">{activeNotification.content}</p>
              <Button 
                size="sm" 
                variant={activeNotification.category === 'urgent' ? 'danger' : activeNotification.category === 'success' ? 'success' : 'primary'}
                className="w-full"
                onClick={() => { markAsRead(activeNotification.id); setActiveNotification(null); }}
              >
                Entendido
              </Button>
            </div>
          </div>
        </Card>
      </motion.div>
    </AnimatePresence>
  );
};

const UserProfileAvatar = ({ user }: { user: UserProfile }) => {
  const [isUploading, setIsUploading] = useState(false);

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user.id) return;

    setIsUploading(true);
    const reader = new FileReader();
    reader.onloadend = async () => {
      try {
        await updateDoc(doc(db, 'users', user.id!), {
          photoUrl: reader.result as string
        });
      } catch (error) {
        console.error("Error updating profile photo:", error);
      } finally {
        setIsUploading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <label className="cursor-pointer group relative block">
      <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold overflow-hidden border-2 border-slate-200 transition-colors ${isUploading ? 'opacity-50' : 'group-hover:border-indigo-400'}`}>
        {user.photoUrl ? (
          <img src={user.photoUrl} className="w-full h-full object-cover" alt={user.name} />
        ) : (
          <div className="w-full h-full bg-indigo-100 text-indigo-600 flex items-center justify-center">
            {user.name.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity rounded-full">
          <Camera size={14} className="text-white" />
        </div>
      </div>
      <input type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} disabled={isUploading} />
    </label>
  );
};

const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ensureDefaultSchool = async () => {
      try {
        const schoolDoc = await getDoc(doc(db, 'schools', 'default-school'));
        if (!schoolDoc.exists()) {
          await setDoc(doc(db, 'schools', 'default-school'), {
            name: 'Colegio Nexo Internacional',
            address: 'Av. de las Familias 123, Ciudad Educativa',
            logoUrl: 'https://picsum.photos/seed/school/200/200',
            phone: '+1 234 567 890',
            email: 'contacto@nexo.edu',
            website: 'www.nexo.edu'
          });
        }
      } catch (error) {
        // Silent fail if not admin or permissions missing
        if (error instanceof Error && !error.message.includes('insufficient permissions')) {
          console.error("Error ensuring default school:", error);
        }
      }
    };

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      console.log("Auth state changed:", firebaseUser?.email || "No user");
      if (firebaseUser) {
        try {
          const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          if (userDoc.exists()) {
            const userData = userDoc.data() as UserProfile;
            console.log("User doc found:", userData.role);
            setUser(userData);
          } else {
            console.log("User doc not found, checking for pre-created account...");
            // Check if admin pre-created a user with this email
            const usersRef = collection(db, 'users');
            const q = query(usersRef, where('email', '==', firebaseUser.email));
            const querySnapshot = await getDocs(q);

            if (!querySnapshot.empty) {
              const existingDoc = querySnapshot.docs[0];
              const existingData = existingDoc.data() as UserProfile;
              console.log("Pre-created account found for email:", firebaseUser.email);
              
              const newUser: UserProfile = {
                ...existingData,
                uid: firebaseUser.uid,
                name: firebaseUser.displayName || existingData.name,
              };
              await setDoc(doc(db, 'users', firebaseUser.uid), newUser);
              await deleteDoc(doc(db, 'users', existingDoc.id));
              setUser(newUser);
            } else {
              console.log("No pre-created account, using default parent role");
              // Default to parent if not pre-created
              const newUser: UserProfile = {
                uid: firebaseUser.uid,
                email: firebaseUser.email || '',
                name: firebaseUser.displayName || 'Usuario',
                role: 'parent',
                schoolId: 'default-school'
              };
              await setDoc(doc(db, 'users', firebaseUser.uid), newUser);
              setUser(newUser);
            }
          }
        } catch (error) {
          console.error("Error in onAuthStateChanged:", error);
        }
      } else {
        setUser(null);
      }
      setLoading(false);
    });
    
    // Safety fallback for loading state
    const timeoutId = setTimeout(() => {
      setLoading(current => {
        if (current) {
          console.warn("Auth loading timeout reached, forcing loading false");
          return false;
        }
        return current;
      });
    }, 10000);

    return () => {
      unsubscribe();
      clearTimeout(timeoutId);
    };
  }, []);

  const login = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login error:", error);
    }
  };

  const logout = async () => {
    if (user?.uid.startsWith('guest-')) {
      setUser(null);
    } else {
      await signOut(auth);
    }
  };

  const setGuestUser = (role: 'parent' | 'school' | 'admin') => {
    setUser(mockUsers[role]);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, setGuestUser }}>
      {children}
    </AuthContext.Provider>
  );
};

const Login = () => {
  const { login, setGuestUser } = useAuth();
  const [role, setRole] = useState<'parent' | 'school' | 'admin'>('parent');

  const handleLogin = async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const firebaseUser = result.user;
      const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
      
      if (!userDoc.exists()) {
        // Check if admin pre-created a user with this email
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('email', '==', firebaseUser.email));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
          const existingDoc = querySnapshot.docs[0];
          const existingData = existingDoc.data() as UserProfile;
          
          const newUser: UserProfile = {
            ...existingData,
            uid: firebaseUser.uid,
            name: firebaseUser.displayName || existingData.name,
          };
          await setDoc(doc(db, 'users', firebaseUser.uid), newUser);
          await deleteDoc(doc(db, 'users', existingDoc.id));
        } else {
          const newUser: UserProfile = {
            uid: firebaseUser.uid,
            email: firebaseUser.email || '',
            name: firebaseUser.displayName || 'Usuario',
            role: role,
            schoolId: 'default-school'
          };
          await setDoc(doc(db, 'users', firebaseUser.uid), newUser);
          
          // Seed some data for the new user
          if (role === 'parent') {
            await addDoc(collection(db, 'students'), {
              name: 'Mateo García',
              schoolId: 'default-school',
              parentId: firebaseUser.uid,
              photoUrl: 'https://picsum.photos/seed/child1/200/200'
            });
            await addDoc(collection(db, 'students'), {
              name: 'Sofía García',
              schoolId: 'default-school',
              parentId: firebaseUser.uid,
              photoUrl: 'https://picsum.photos/seed/child2/200/200'
            });
          }
          
          if (role === 'school') {
            // Add initial communication
            await addDoc(collection(db, 'communications'), {
              schoolId: 'default-school',
              title: 'Bienvenidos al nuevo ciclo escolar',
              content: 'Estimados padres, les damos la bienvenida al ciclo 2026. Recuerden que el horario de ingreso es a las 08:00 AM.',
              date: new Date().toISOString(),
              isImportant: true,
              summary: 'Bienvenida al ciclo 2026. Ingreso 08:00 AM.'
            });
          }
        }
      }
    } catch (error: any) {
      if (error.code === 'auth/popup-closed-by-user') {
        console.log("Login popup closed by user");
        return;
      }
      console.error("Login error:", error);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white rounded-[40px] shadow-2xl shadow-indigo-100 p-10 text-center"
      >
        <div className="w-24 h-24 mx-auto mb-8">
          <Logo size={96} className="rounded-[2rem] shadow-2xl shadow-indigo-100" />
        </div>
        <h1 className="text-4xl font-bold tracking-tight text-slate-900 mb-2">Nexo</h1>
        <p className="text-slate-500 mb-8 font-medium">El nexo inteligente entre familias y colegios</p>
        
        <div className="flex bg-slate-100 p-1.5 rounded-2xl mb-8">
          <button 
            onClick={() => setRole('parent')}
            className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${role === 'parent' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}
          >
            Padre
          </button>
          <button 
            onClick={() => setRole('school')}
            className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${role === 'school' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}
          >
            Colegio
          </button>
          <button 
            onClick={() => setRole('admin')}
            className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${role === 'admin' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}
          >
            Admin
          </button>
        </div>

        <Button onClick={handleLogin} className="w-full py-4 text-lg">
          <img src="https://www.google.com/favicon.ico" className="w-5 h-5" alt="Google" />
          Continuar con Google
        </Button>

        <div className="mt-4">
          <Button onClick={() => setGuestUser(role)} variant="secondary" className="w-full py-4 text-lg border-2 border-indigo-100">
            Entrar como Invitado ({role === 'parent' ? 'Padre' : role === 'school' ? 'Colegio' : 'Admin'})
          </Button>
        </div>
        
        <p className="mt-8 text-xs text-slate-400 leading-relaxed">
          Al continuar, aceptas nuestros términos de servicio y política de privacidad.
        </p>
      </motion.div>
    </div>
  );
};

const ParentDashboard = () => {
  const { user, logout } = useAuth();
  const { addNotification } = useNotifications();
  const [comms, setComms] = useState<Communication[]>([]);
  const [auths, setAuths] = useState<Authorization[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const studentsRef = useRef<Student[]>([]);
  const authsRef = useRef<Authorization[]>([]);
  const [school, setSchool] = useState<School | null>(null);
  const [activeTab, setActiveTab] = useState<'inbox' | 'auths' | 'students' | 'calendar' | 'messages'>('inbox');
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isStudentModalOpen, setIsStudentModalOpen] = useState(false);
  const [isEditStudentModalOpen, setIsEditStudentModalOpen] = useState(false);
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [editingAuth, setEditingAuth] = useState<Authorization | null>(null);
  const [editingComm, setEditingComm] = useState<Communication | null>(null);
  const [isEditAuthModalOpen, setIsEditAuthModalOpen] = useState(false);
  const [isEditCommModalOpen, setIsEditCommModalOpen] = useState(false);
  const [newAuth, setNewAuth] = useState({ studentId: '', name: '', dni: '', expiresAt: '' });
  const [newStudent, setNewStudent] = useState({ name: '', grade: '', class: '', description: '', photoUrl: '' });
  const [newEvent, setNewEvent] = useState({ title: '', content: '', date: '', location: '', category: 'event' as 'event' | 'message' | 'urgent' });
  const [searchQuery, setSearchQuery] = useState('');
  const [pinnedComms, setPinnedComms] = useState<string[]>([]);

  useEffect(() => {
    studentsRef.current = students;
  }, [students]);

  useEffect(() => {
    authsRef.current = auths;
  }, [auths]);

  const handleDeleteAuth = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'authorizations', id));
      addNotification({
        title: 'Eliminado',
        content: 'Autorización eliminada con éxito',
        category: 'info',
        isImportant: false
      });
    } catch (error) {
      handleFirestoreError(error, FirestoreOperationType.DELETE, `authorizations/${id}`);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, callback: (url: string) => void) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        callback(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newStudent.name || !auth.currentUser) return;

    try {
      await addDoc(collection(db, 'students'), {
        name: newStudent.name,
        grade: newStudent.grade,
        class: newStudent.class,
        description: newStudent.description,
        schoolId: user.schoolId || 'default-school',
        parentId: user.uid,
        photoUrl: newStudent.photoUrl || `https://picsum.photos/seed/${newStudent.name}/200/200`
      });
      setIsStudentModalOpen(false);
      setNewStudent({ name: '', grade: '', class: '', description: '', photoUrl: '' });
    } catch (error) {
      handleFirestoreError(error, FirestoreOperationType.CREATE, 'students');
    }
  };

  useEffect(() => {
    if (!user?.uid || !auth.currentUser) return;

    // Fetch communications
    const qComms = query(collection(db, 'communications'), where('schoolId', '==', user.schoolId || 'default-school'));
    const unsubComms = onSnapshot(qComms, (snapshot) => {
      const newComms = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Communication));
      
      // Check for new communications to trigger notifications
      snapshot.docChanges().forEach(change => {
        if (change.type === 'added') {
          const data = change.doc.data() as Communication;
          
          // Check if it's for this parent's students
          const isForMe = !data.targetGrades || data.targetGrades.length === 0 || 
                          studentsRef.current.some(s => s.grade && data.targetGrades!.includes(s.grade));
                          
          // Only notify if it's not from the initial load (simple check using timestamp)
          const isRecent = new Date(data.date).getTime() > Date.now() - 10000;
          if (isRecent && isForMe) {
            addNotification({
              title: data.title,
              content: data.content,
              category: data.category || 'info',
              isImportant: data.isImportant || false
            });
          }
        }
      });

      setComms(newComms);
    }, (error) => handleFirestoreError(error, FirestoreOperationType.LIST, 'communications'));

    // Fetch authorizations
    const qAuths = query(collection(db, 'authorizations'), where('parentId', '==', user.uid));
    const unsubAuths = onSnapshot(qAuths, (snapshot) => {
      const now = new Date();
      const updatedAuths = snapshot.docs.map(docSnap => {
        const data = docSnap.data() as Authorization;
        const id = docSnap.id;
        
        // Auto-expire check
        if (data.status === 'pending' && data.expiresAt && new Date(data.expiresAt) < now) {
          updateDoc(doc(db, 'authorizations', id), { status: 'expired' });
          return { ...data, id, status: 'expired' } as Authorization;
        }
        
        return { id, ...data } as Authorization;
      });

      // Notify on status changes
      snapshot.docChanges().forEach(change => {
        if (change.type === 'modified') {
          const newData = change.doc.data() as Authorization;
          const oldData = authsRef.current.find(a => a.id === change.doc.id);
          
          if (newData.status === 'used' && oldData?.status !== 'used') {
            const student = studentsRef.current.find(s => s.id === newData.studentId);
            addNotification({
              title: 'Retiro Confirmado ✅',
              content: `${student?.name || 'El alumno'} ha sido retirado por ${newData.authorizedPersonName}.`,
              category: 'success',
              isImportant: true
            });
          }
        }
      });

      setAuths(updatedAuths);
    }, (error) => handleFirestoreError(error, FirestoreOperationType.LIST, 'authorizations'));

    // Fetch students
    const qStudents = query(collection(db, 'students'), where('parentId', '==', user.uid));
    const unsubStudents = onSnapshot(qStudents, (snapshot) => {
      setStudents(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Student)));
    }, (error) => handleFirestoreError(error, FirestoreOperationType.LIST, 'students'));

    // Fetch school info
    let unsubSchool = () => {};
    if (user.schoolId) {
      unsubSchool = onSnapshot(doc(db, 'schools', user.schoolId), (docSnap) => {
        if (docSnap.exists()) {
          setSchool({ id: docSnap.id, ...docSnap.data() } as School);
        }
      }, (error) => handleFirestoreError(error, FirestoreOperationType.GET, `schools/${user.schoolId}`));
    }

    return () => {
      unsubComms();
      unsubAuths();
      unsubStudents();
      unsubSchool();
    };
  }, [user?.uid, user?.schoolId, auth.currentUser]);

  const handleUpdateAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !editingAuth || !auth.currentUser) return;

    try {
      await updateDoc(doc(db, 'authorizations', editingAuth.id), {
        authorizedPersonName: editingAuth.authorizedPersonName,
        authorizedPersonDni: editingAuth.authorizedPersonDni || '',
        expiresAt: editingAuth.expiresAt || ''
      });
      setIsEditAuthModalOpen(false);
      setEditingAuth(null);
      addNotification({
        title: 'Actualizado',
        content: 'Autorización actualizada con éxito',
        category: 'info',
        isImportant: false
      });
    } catch (error) {
      handleFirestoreError(error, FirestoreOperationType.UPDATE, `authorizations/${editingAuth.id}`);
    }
  };

  const handleUpdateComm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !editingComm || !auth.currentUser) return;

    try {
      await updateDoc(doc(db, 'communications', editingComm.id), {
        title: editingComm.title,
        content: editingComm.content,
        category: editingComm.category,
        deadline: editingComm.deadline || '',
        location: editingComm.location || ''
      });
      setIsEditCommModalOpen(false);
      setEditingComm(null);
      addNotification({
        title: 'Actualizado',
        content: 'Comunicación actualizada con éxito',
        category: 'info',
        isImportant: false
      });
    } catch (error) {
      handleFirestoreError(error, FirestoreOperationType.UPDATE, `communications/${editingComm.id}`);
    }
  };

  const handleUpdateStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !editingStudent || !auth.currentUser) return;

    try {
      await updateDoc(doc(db, 'students', editingStudent.id), {
        name: editingStudent.name,
        grade: editingStudent.grade,
        class: editingStudent.class,
        description: editingStudent.description || '',
        photoUrl: editingStudent.photoUrl || `https://picsum.photos/seed/${editingStudent.name}/200/200`
      });
      setIsEditStudentModalOpen(false);
      setEditingStudent(null);
    } catch (error) {
      handleFirestoreError(error, FirestoreOperationType.UPDATE, `students/${editingStudent.id}`);
    }
  };

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newEvent.title || !newEvent.date) return;

    try {
      await addDoc(collection(db, 'communications'), {
        schoolId: user.schoolId || 'default-school',
        title: newEvent.title,
        content: newEvent.content,
        date: new Date().toISOString(),
        deadline: newEvent.category === 'event' ? new Date(newEvent.date).toISOString() : undefined,
        location: newEvent.location,
        category: newEvent.category,
        authorId: user.uid,
        isImportant: newEvent.category === 'urgent'
      });
      setIsEventModalOpen(false);
      setNewEvent({ title: '', content: '', date: '', location: '', category: 'event' });
      addNotification({
        title: 'Éxito',
        content: newEvent.category === 'event' ? 'Evento/Reunión solicitado con éxito' : 'Mensaje enviado con éxito',
        category: 'info',
        isImportant: false
      });
    } catch (error) {
      handleFirestoreError(error, FirestoreOperationType.CREATE, 'communications');
    }
  };

  const handleCreateAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newAuth.studentId || !newAuth.name || !auth.currentUser) return;

    const selectedStudent = students.find(s => s.id === newAuth.studentId);
    const qrCode = `AUTH-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const authData: Omit<Authorization, 'id'> = {
      studentId: newAuth.studentId,
      authorizedPersonName: newAuth.name,
      authorizedPersonDni: newAuth.dni,
      date: new Date().toISOString(),
      expiresAt: newAuth.expiresAt || new Date(new Date().setHours(23, 59, 59, 999)).toISOString(),
      qrCode,
      status: 'pending',
      schoolId: selectedStudent?.schoolId || user.schoolId || 'default',
      parentId: user.uid
    };

    try {
      await addDoc(collection(db, 'authorizations'), authData);
      setIsAuthModalOpen(false);
      setNewAuth({ studentId: '', name: '', dni: '', expiresAt: '' });
    } catch (error) {
      handleFirestoreError(error, FirestoreOperationType.CREATE, 'authorizations');
    }
  };

  const togglePin = (id: string) => {
    setPinnedComms(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]);
  };

  const filteredComms = comms
    .filter(c => {
      if (!c.targetGrades || c.targetGrades.length === 0) return true;
      return students.some(student => student.grade && c.targetGrades!.includes(student.grade));
    })
    .filter(c => c.title.toLowerCase().includes(searchQuery.toLowerCase()) || c.content.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => {
      const aPinned = pinnedComms.includes(a.id);
      const bPinned = pinnedComms.includes(b.id);
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <Logo size={40} />
          <h1 className="font-bold text-xl tracking-tight hidden sm:block">Nexo</h1>
        </div>
        <div className="flex items-center gap-4">
          {school?.logoUrl && (
            <div className="w-10 h-10 rounded-lg overflow-hidden border border-slate-200 hidden sm:block">
              <img src={school.logoUrl} className="w-full h-full object-contain" alt="School Logo" referrerPolicy="no-referrer" />
            </div>
          )}
          <ThemeToggle />
          <NotificationToggle />
          {user && <UserProfileAvatar user={user} />}
          <div className="text-right hidden sm:block">
            <p className="text-sm font-bold">{user?.name}</p>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Padre de Familia</p>
          </div>
          <Button variant="ghost" onClick={logout} className="p-2">
            <LogOut size={20} />
          </Button>
        </div>
      </header>

      {/* Navigation */}
      <div className="bg-white border-b border-slate-200 px-4 sm:px-6 flex flex-col sm:flex-row items-stretch sm:items-center gap-1 sm:gap-8 py-2 sm:py-0">
        <button 
          onClick={() => setActiveTab('inbox')}
          className={`py-3 sm:py-4 px-4 sm:px-2 font-bold text-sm transition-all border-l-4 sm:border-l-0 sm:border-b-2 text-left sm:text-center rounded-r-lg sm:rounded-none ${activeTab === 'inbox' ? 'border-indigo-600 text-indigo-600 bg-indigo-50 sm:bg-transparent' : 'border-transparent text-slate-500 hover:text-indigo-400 hover:bg-slate-50 sm:hover:bg-transparent'}`}
        >
          Inbox
        </button>
        <button 
          onClick={() => setActiveTab('auths')}
          className={`py-3 sm:py-4 px-4 sm:px-2 font-bold text-sm transition-all border-l-4 sm:border-l-0 sm:border-b-2 text-left sm:text-center rounded-r-lg sm:rounded-none ${activeTab === 'auths' ? 'border-emerald-600 text-emerald-600 bg-emerald-50 sm:bg-transparent' : 'border-transparent text-slate-500 hover:text-emerald-400 hover:bg-slate-50 sm:hover:bg-transparent'}`}
        >
          Autorizaciones
        </button>
        <button 
          onClick={() => setActiveTab('students')}
          className={`py-3 sm:py-4 px-4 sm:px-2 font-bold text-sm transition-all border-l-4 sm:border-l-0 sm:border-b-2 text-left sm:text-center rounded-r-lg sm:rounded-none ${activeTab === 'students' ? 'border-amber-600 text-amber-600 bg-amber-50 sm:bg-transparent' : 'border-transparent text-slate-500 hover:text-amber-400 hover:bg-slate-50 sm:hover:bg-transparent'}`}
        >
          Mis Hijos
        </button>
        <button 
          onClick={() => setActiveTab('calendar')}
          className={`py-3 sm:py-4 px-4 sm:px-2 font-bold text-sm transition-all border-l-4 sm:border-l-0 sm:border-b-2 text-left sm:text-center rounded-r-lg sm:rounded-none ${activeTab === 'calendar' ? 'border-violet-600 text-violet-600 bg-violet-50 sm:bg-transparent' : 'border-transparent text-slate-500 hover:text-violet-400 hover:bg-slate-50 sm:hover:bg-transparent'}`}
        >
          Calendario
        </button>
        <button 
          onClick={() => setActiveTab('messages')}
          className={`py-3 sm:py-4 px-4 sm:px-2 font-bold text-sm transition-all border-l-4 sm:border-l-0 sm:border-b-2 text-left sm:text-center rounded-r-lg sm:rounded-none ${activeTab === 'messages' ? 'border-rose-600 text-rose-600 bg-rose-50 sm:bg-transparent' : 'border-transparent text-slate-500 hover:text-rose-400 hover:bg-slate-50 sm:hover:bg-transparent'}`}
        >
          Mensajes
        </button>
      </div>

      {/* Content */}
      <main className="flex-1 p-6 max-w-4xl mx-auto w-full">
        <AnimatePresence mode="wait">
          {activeTab === 'inbox' && (
            <motion.div 
              key="inbox"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <h2 className="text-2xl font-bold">Comunicados</h2>
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                  <input 
                    type="text" 
                    placeholder="Buscar comunicados..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/20 transition-all w-full"
                  />
                </div>
              </div>
              
              {filteredComms.length === 0 ? (
                <Card className="text-center py-12">
                  <Inbox size={48} className="mx-auto text-slate-200 mb-4" />
                  <p className="text-slate-500 font-medium">No se encontraron comunicados</p>
                </Card>
              ) : (
                filteredComms.map(comm => (
                  <Card key={`inbox-${comm.id}`} className={`hover:shadow-md transition-shadow ${pinnedComms.includes(comm.id) ? 'border-indigo-200 bg-indigo-50/10' : ''}`}>
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-lg">{comm.title}</h3>
                        {comm.category && (
                          <Badge variant={comm.category === 'urgent' ? 'danger' : comm.category === 'event' ? 'info' : 'default'}>
                            {comm.category}
                          </Badge>
                        )}
                      </div>
                      <div className="flex gap-1">
                        <button 
                          onClick={() => togglePin(comm.id)}
                          className={`p-2 rounded-lg transition-colors ${pinnedComms.includes(comm.id) ? 'text-indigo-600 bg-indigo-50' : 'text-slate-300 hover:bg-slate-50'}`}
                        >
                          <Plus size={20} className={pinnedComms.includes(comm.id) ? 'rotate-45' : ''} />
                        </button>
                        <button 
                          onClick={() => addToCalendar(comm)}
                          className="p-2 rounded-lg text-slate-300 hover:bg-slate-50 hover:text-indigo-600 transition-colors"
                        >
                          <CalendarIcon size={20} />
                        </button>
                      </div>
                    </div>
                    {comm.summary && (
                      <div className="bg-indigo-50 p-3 rounded-xl mb-4 flex gap-3 items-start border border-indigo-100">
                        <Info size={18} className="text-indigo-500 shrink-0 mt-0.5" />
                        <p className="text-xs text-indigo-800 font-medium leading-relaxed">
                          <span className="font-bold uppercase tracking-wider text-[10px] block mb-1">Resumen IA</span>
                          {comm.summary}
                        </p>
                      </div>
                    )}
                    <p className="text-slate-600 text-sm leading-relaxed mb-4">{comm.content}</p>
                    {comm.deadline && (
                      <div className="flex items-center gap-2 mb-4 p-2 bg-rose-50 rounded-lg border border-rose-100">
                        <AlertCircle size={14} className="text-rose-500" />
                        <p className="text-[10px] font-bold text-rose-700 uppercase">
                          Acción requerida antes del: {format(new Date(comm.deadline), "d 'de' MMMM", { locale: es })}
                        </p>
                      </div>
                    )}
                    <div className="flex items-center justify-between pt-4 border-t border-slate-50">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        {format(new Date(comm.date), "d 'de' MMMM, HH:mm", { locale: es })}
                      </span>
                      <Button variant="secondary" className="py-1.5 px-3 text-xs" onClick={() => addToCalendar(comm)}>
                        <Plus size={14} />
                        Calendario
                      </Button>
                    </div>
                  </Card>
                ))
              )}
            </motion.div>
          )}

          {activeTab === 'messages' && (
            <motion.div 
              key="messages"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold">Mensajes al Colegio</h2>
                <Button onClick={() => setIsEventModalOpen(true)}>
                  <Plus size={20} />
                  Nuevo Mensaje
                </Button>
              </div>

              <div className="space-y-4">
                {comms
                  .filter(c => (c.category === 'event' || c.category === 'message') && c.authorId === user.uid)
                  .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                  .map(comm => (
                    <Card key={`msg-${comm.id}`}>
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-lg">{comm.title}</h4>
                          <Badge variant={comm.category === 'event' ? 'info' : 'success'}>
                            {comm.category === 'event' ? 'Solicitud de Evento' : 'Mensaje'}
                          </Badge>
                        </div>
                        <span className="text-[10px] font-bold text-slate-400 uppercase">
                          {format(new Date(comm.date), 'dd/MM/yyyy HH:mm')}
                        </span>
                      </div>
                      <p className="text-slate-600 text-sm mb-4">{comm.content}</p>
                      <div className="flex items-center justify-between pt-4 border-t border-slate-50">
                        <div className="flex items-center gap-2">
                          <Badge variant="default">Enviado</Badge>
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-[10px]" onClick={() => { setEditingComm(comm); setIsEditCommModalOpen(true); }}>
                            <Edit size={12} />
                            Editar
                          </Button>
                        </div>
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Esperando respuesta</span>
                      </div>
                    </Card>
                  ))}
                
                {comms.filter(c => (c.category === 'event' || c.category === 'message') && c.authorId === user.uid).length === 0 && (
                  <Card className="text-center py-12">
                    <Inbox size={48} className="mx-auto text-slate-200 mb-4" />
                    <p className="text-slate-500 font-medium">No has enviado mensajes recientemente</p>
                  </Card>
                )}
              </div>
            </motion.div>
          )}

          {activeTab === 'auths' && (
            <motion.div 
              key="auths"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4"
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold">Autorizaciones</h2>
                <Button onClick={() => setIsAuthModalOpen(true)}>
                  <Plus size={20} />
                  Nueva
                </Button>
              </div>

              {auths.length === 0 ? (
                <Card className="text-center py-12">
                  <Shield size={48} className="mx-auto text-slate-200 mb-4" />
                  <p className="text-slate-500 font-medium">No has generado autorizaciones</p>
                </Card>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {auths.map(auth => (
                    <Card key={`auth-${auth.id}`} className="flex flex-col items-center text-center relative group">
                      {(auth.status === 'used' || auth.status === 'expired') && (
                        <button 
                          onClick={() => handleDeleteAuth(auth.id)}
                          className="absolute top-4 right-4 p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                          title="Eliminar"
                        >
                          <Trash2 size={18} />
                        </button>
                      )}
                      <div className="mb-4">
                        <QRCodeSVG value={auth.qrCode} size={120} />
                      </div>
                      <Badge variant={auth.status === 'pending' ? 'warning' : 'success'}>
                        {auth.status === 'pending' ? 'Pendiente' : 'Retirado'}
                      </Badge>
                      <div className="flex gap-2 mt-2">
                        {auth.status === 'pending' && (
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-[10px]" onClick={() => { setEditingAuth(auth); setIsEditAuthModalOpen(true); }}>
                            <Edit size={12} />
                            Editar
                          </Button>
                        )}
                      </div>
                      <h4 className="font-bold mt-3">{auth.authorizedPersonName}</h4>
                      <p className="text-xs text-slate-500 mt-1">
                        {students.find(s => s.id === auth.studentId)?.name || 'Alumno'}
                      </p>
                      <p className="text-[10px] text-slate-400 font-bold uppercase mt-4">
                        {format(new Date(auth.date), "d MMM, HH:mm", { locale: es })}
                      </p>
                    </Card>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'students' && (
            <motion.div 
              key="students"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4"
            >
              <h2 className="text-2xl font-bold mb-6">Mis Hijos</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {students.map(student => (
                  <Card key={`student-${student.id}`} className="flex flex-col gap-4">
                    <div className="flex items-center gap-4">
                      <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-400 overflow-hidden">
                        {student.photoUrl ? (
                          <img src={student.photoUrl} className="w-full h-full object-cover" alt={student.name} />
                        ) : (
                          <User size={32} />
                        )}
                      </div>
                      <div className="flex-1">
                        <h4 className="font-bold">{student.name}</h4>
                        <div className="flex gap-2 mt-1">
                          <Badge variant="default">{student.grade || 'Grado'}</Badge>
                          <Badge variant="default">{student.class || 'Sección'}</Badge>
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => { setEditingStudent(student); setIsEditStudentModalOpen(true); }}>
                        <Plus size={16} className="rotate-45" />
                        Editar
                      </Button>
                    </div>
                    {student.description && (
                      <p className="text-xs text-slate-500 italic px-2 border-l-2 border-indigo-200">
                        {student.description}
                      </p>
                    )}
                    <p className="text-[10px] text-slate-400 font-bold uppercase">ID: {student.id.slice(0, 8)}</p>
                  </Card>
                ))}
                <Card 
                  onClick={() => setIsStudentModalOpen(true)}
                  className="border-dashed border-2 flex items-center justify-center py-8 cursor-pointer hover:bg-slate-50 transition-colors"
                >
                  <div className="text-center">
                    <Plus size={24} className="mx-auto text-slate-300 mb-2" />
                    <p className="text-sm font-bold text-slate-400">Vincular Alumno</p>
                  </div>
                </Card>
              </div>

              {/* Student Modal */}
              <AnimatePresence>
                {isStudentModalOpen && (
                  <div key="student-modal" className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      onClick={() => setIsStudentModalOpen(false)}
                      className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
                    />
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="bg-white w-full max-w-md rounded-3xl p-8 shadow-2xl relative z-10"
                    >
                      <h3 className="text-xl font-bold mb-6">Vincular Nuevo Alumno</h3>
                      <form onSubmit={handleAddStudent} className="space-y-4">
                        <div className="flex justify-center mb-4">
                          <div className="relative group">
                            <div className="w-24 h-24 bg-slate-100 rounded-full overflow-hidden border-4 border-white shadow-lg">
                              <img src={newStudent.photoUrl || `https://picsum.photos/seed/${newStudent.name || 'new'}/200/200`} className="w-full h-full object-cover" alt="Preview" />
                            </div>
                            <label className="absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-0 group-hover:opacity-100 rounded-full cursor-pointer transition-opacity">
                              <Camera size={20} />
                              <input 
                                type="file" 
                                accept="image/*"
                                className="absolute inset-0 opacity-0 cursor-pointer"
                                onChange={e => handleFileChange(e, (url) => setNewStudent({...newStudent, photoUrl: url}))}
                              />
                            </label>
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Nombre del Alumno</label>
                          <input 
                            required
                            type="text" 
                            placeholder="Ej. Mateo García"
                            value={newStudent.name}
                            onChange={e => setNewStudent({...newStudent, name: e.target.value})}
                            className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500/20 transition-all"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Grado</label>
                            <input 
                              type="text" 
                              placeholder="Ej. 1ro Primaria"
                              value={newStudent.grade}
                              onChange={e => setNewStudent({...newStudent, grade: e.target.value})}
                              className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500/20 transition-all"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Sección</label>
                            <input 
                              type="text" 
                              placeholder="Ej. A"
                              value={newStudent.class}
                              onChange={e => setNewStudent({...newStudent, class: e.target.value})}
                              className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500/20 transition-all"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Descripción / Notas</label>
                          <textarea 
                            placeholder="Ej. Alérgico al maní, usa anteojos..."
                            value={newStudent.description}
                            onChange={e => setNewStudent({...newStudent, description: e.target.value})}
                            className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500/20 transition-all resize-none"
                            rows={3}
                          />
                        </div>
                        <div className="pt-4 flex gap-3">
                          <Button variant="secondary" className="flex-1" onClick={() => setIsStudentModalOpen(false)}>Cancelar</Button>
                          <Button type="submit" className="flex-1">Vincular</Button>
                        </div>
                      </form>
                    </motion.div>
                  </div>
                )}
              </AnimatePresence>

              {/* Edit Student Modal */}
              <AnimatePresence>
                {isEditStudentModalOpen && editingStudent && (
                  <div key="edit-student-modal" className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      onClick={() => setIsEditStudentModalOpen(false)}
                      className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
                    />
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="bg-white w-full max-w-md rounded-3xl p-8 shadow-2xl relative z-10"
                    >
                      <h3 className="text-xl font-bold mb-6">Editar Alumno</h3>
                      <form onSubmit={handleUpdateStudent} className="space-y-4">
                        <div className="flex justify-center mb-4">
                          <div className="relative group">
                            <div className="w-24 h-24 bg-slate-100 rounded-full overflow-hidden border-4 border-white shadow-lg">
                              <img src={editingStudent.photoUrl || `https://picsum.photos/seed/${editingStudent.name}/200/200`} className="w-full h-full object-cover" alt="Preview" />
                            </div>
                            <label className="absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-0 group-hover:opacity-100 rounded-full cursor-pointer transition-opacity">
                              <Camera size={20} />
                              <input 
                                type="file" 
                                accept="image/*"
                                className="absolute inset-0 opacity-0 cursor-pointer"
                                onChange={e => handleFileChange(e, (url) => setEditingStudent({...editingStudent, photoUrl: url}))}
                              />
                            </label>
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-400 uppercase mb-2">URL de Foto (Opcional)</label>
                          <input 
                            type="text" 
                            placeholder="https://..."
                            value={editingStudent.photoUrl || ''}
                            onChange={e => setEditingStudent({...editingStudent, photoUrl: e.target.value})}
                            className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500/20 transition-all"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Nombre</label>
                          <input 
                            required
                            type="text" 
                            value={editingStudent.name}
                            onChange={e => setEditingStudent({...editingStudent, name: e.target.value})}
                            className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500/20 transition-all"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Grado</label>
                            <input 
                              type="text" 
                              value={editingStudent.grade || ''}
                              onChange={e => setEditingStudent({...editingStudent, grade: e.target.value})}
                              className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500/20 transition-all"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Sección</label>
                            <input 
                              type="text" 
                              value={editingStudent.class || ''}
                              onChange={e => setEditingStudent({...editingStudent, class: e.target.value})}
                              className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500/20 transition-all"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Descripción / Notas</label>
                          <textarea 
                            value={editingStudent.description || ''}
                            onChange={e => setEditingStudent({...editingStudent, description: e.target.value})}
                            className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500/20 transition-all resize-none"
                            rows={3}
                          />
                        </div>
                        <div className="pt-4 flex gap-3">
                          <Button variant="secondary" className="flex-1" onClick={() => setIsEditStudentModalOpen(false)}>Cancelar</Button>
                          <Button type="submit" className="flex-1">Guardar Cambios</Button>
                        </div>
                      </form>
                    </motion.div>
                  </div>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {activeTab === 'calendar' && (
            <motion.div 
              key="calendar"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold">Calendario Escolar</h2>
                <Button onClick={() => setIsEventModalOpen(true)}>Solicitar Reunión</Button>
              </div>
              <div className="grid grid-cols-1 gap-4">
                {filteredComms.filter(c => c.category === 'event' || c.deadline).sort((a, b) => new Date(a.deadline || a.date).getTime() - new Date(b.deadline || b.date).getTime()).map(event => (
                  <Card key={`cal-parent-${event.id}`} className="flex gap-4 items-start">
                    <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex flex-col items-center justify-center text-white shrink-0">
                      <span className="text-[10px] font-bold uppercase">{format(new Date(event.deadline || event.date), 'MMM', { locale: es })}</span>
                      <span className="text-xl font-bold">{format(new Date(event.deadline || event.date), 'dd')}</span>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-bold text-lg">{event.title}</h4>
                        {event.category === 'urgent' && <Badge variant="danger">Urgente</Badge>}
                        {event.authorId === user.uid && <Badge variant="success">Mío</Badge>}
                      </div>
                      <p className="text-sm text-slate-600 line-clamp-2">{event.content}</p>
                      {event.location && (
                        <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                          <Home size={12} />
                          {event.location}
                        </p>
                      )}
                      <div className="flex items-center gap-4 mt-3">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                          <CalendarIcon size={12} />
                          {format(new Date(event.deadline || event.date), "EEEE d 'de' MMMM", { locale: es })}
                        </span>
                        <Button variant="ghost" size="sm" className="text-indigo-600 p-0 h-auto" onClick={() => addToCalendar(event)}>
                          Agendar
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
                {comms.filter(c => c.category === 'event' || c.deadline).length === 0 && (
                  <Card className="text-center py-12">
                    <CalendarIcon size={48} className="mx-auto text-slate-200 mb-4" />
                    <p className="text-slate-500 font-medium">No hay eventos programados</p>
                  </Card>
                )}
              </div>

              {/* Event Modal */}
              <AnimatePresence>
                {isEventModalOpen && (
                  <div key="parent-event-modal" className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      onClick={() => setIsEventModalOpen(false)}
                      className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
                    />
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="bg-white w-full max-w-md rounded-3xl p-8 shadow-2xl relative z-10"
                    >
                      <h3 className="text-xl font-bold mb-6">{newEvent.category === 'message' ? 'Enviar Mensaje' : 'Solicitar Reunión o Evento'}</h3>
                      <form onSubmit={handleCreateEvent} className="space-y-4">
                        <div>
                          <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Categoría</label>
                          <select 
                            value={newEvent.category}
                            onChange={e => setNewEvent({...newEvent, category: e.target.value as any})}
                            className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500/20 transition-all"
                          >
                            <option value="event">Solicitud de Reunión</option>
                            <option value="message">Mensaje General</option>
                            <option value="urgent">Urgente</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Título</label>
                          <input 
                            required
                            type="text" 
                            placeholder={newEvent.category === 'message' ? "Asunto del mensaje" : "Ej. Reunión con Profesor de Matemáticas"}
                            value={newEvent.title}
                            onChange={e => setNewEvent({...newEvent, title: e.target.value})}
                            className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500/20 transition-all"
                          />
                        </div>
                        {newEvent.category !== 'message' && (
                          <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Fecha y Hora</label>
                            <input 
                              required
                              type="datetime-local" 
                              value={newEvent.date}
                              onChange={e => setNewEvent({...newEvent, date: e.target.value})}
                              className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500/20 transition-all"
                            />
                          </div>
                        )}
                        <div>
                          <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Ubicación (Opcional)</label>
                          <input 
                            type="text" 
                            placeholder="Ej. Salón de Actos o Virtual"
                            value={newEvent.location}
                            onChange={e => setNewEvent({...newEvent, location: e.target.value})}
                            className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500/20 transition-all"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-400 uppercase mb-2">{newEvent.category === 'message' ? 'Mensaje' : 'Motivo / Detalles'}</label>
                          <textarea 
                            required
                            placeholder={newEvent.category === 'message' ? "Escribe tu mensaje aquí..." : "Describe brevemente el motivo de la reunión..."}
                            value={newEvent.content}
                            onChange={e => setNewEvent({...newEvent, content: e.target.value})}
                            className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500/20 transition-all resize-none"
                            rows={3}
                          />
                        </div>
                        <div className="pt-4 flex gap-3">
                          <Button variant="secondary" className="flex-1" onClick={() => setIsEventModalOpen(false)}>Cancelar</Button>
                          <Button type="submit" className="flex-1">{newEvent.category === 'message' ? 'Enviar Mensaje' : 'Enviar Solicitud'}</Button>
                        </div>
                      </form>
                    </motion.div>
                  </div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Modals */}
      {/* Edit Authorization Modal */}
      <AnimatePresence>
        {isEditAuthModalOpen && editingAuth && (
          <div key="edit-auth-modal" className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsEditAuthModalOpen(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-md rounded-3xl p-8 shadow-2xl relative z-10"
            >
                <h3 className="text-xl font-bold mb-6">Editar Autorización</h3>
                <form onSubmit={handleUpdateAuth} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Nombre Autorizado</label>
                    <input 
                      required
                      type="text" 
                      value={editingAuth.authorizedPersonName}
                      onChange={e => setEditingAuth({...editingAuth, authorizedPersonName: e.target.value})}
                      className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500/20 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-2">DNI</label>
                    <input 
                      type="text" 
                      value={editingAuth.authorizedPersonDni || ''}
                      onChange={e => setEditingAuth({...editingAuth, authorizedPersonDni: e.target.value})}
                      className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500/20 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Expira</label>
                    <input 
                      type="datetime-local" 
                      value={editingAuth.expiresAt || ''}
                      onChange={e => setEditingAuth({...editingAuth, expiresAt: e.target.value})}
                      className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500/20 transition-all"
                    />
                  </div>
                  <div className="pt-4 flex gap-3">
                    <Button variant="secondary" className="flex-1" onClick={() => setIsEditAuthModalOpen(false)}>Cancelar</Button>
                    <Button type="submit" className="flex-1">Guardar Cambios</Button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Edit Communication Modal */}
        <AnimatePresence>
          {isEditCommModalOpen && editingComm && (
            <div key="edit-comm-modal" className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsEditCommModalOpen(false)}
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white w-full max-w-md rounded-3xl p-8 shadow-2xl relative z-10"
              >
                <h3 className="text-xl font-bold mb-6">Editar Comunicación</h3>
                <form onSubmit={handleUpdateComm} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Título</label>
                    <input 
                      required
                      type="text" 
                      value={editingComm.title}
                      onChange={e => setEditingComm({...editingComm, title: e.target.value})}
                      className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500/20 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Contenido</label>
                    <textarea 
                      required
                      rows={4}
                      value={editingComm.content}
                      onChange={e => setEditingComm({...editingComm, content: e.target.value})}
                      className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500/20 transition-all resize-none"
                    />
                  </div>
                  {editingComm.category === 'event' && (
                    <>
                      <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Fecha</label>
                        <input 
                          type="datetime-local" 
                          value={editingComm.deadline || ''}
                          onChange={e => setEditingComm({...editingComm, deadline: e.target.value})}
                          className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500/20 transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Ubicación</label>
                        <input 
                          type="text" 
                          value={editingComm.location || ''}
                          onChange={e => setEditingComm({...editingComm, location: e.target.value})}
                          className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500/20 transition-all"
                        />
                      </div>
                    </>
                  )}
                  <div className="pt-4 flex gap-3">
                    <Button variant="secondary" className="flex-1" onClick={() => setIsEditCommModalOpen(false)}>Cancelar</Button>
                    <Button type="submit" className="flex-1">Guardar Cambios</Button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {isAuthModalOpen && (
            <div key="auth-modal" className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsAuthModalOpen(false)}
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white w-full max-w-md rounded-3xl p-8 shadow-2xl relative z-10"
              >
                <h3 className="text-xl font-bold mb-6">Nueva Autorización</h3>
                <form onSubmit={handleCreateAuth} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Alumno</label>
                    <select 
                      required
                      value={newAuth.studentId}
                      onChange={e => setNewAuth({...newAuth, studentId: e.target.value})}
                      className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500/20 transition-all"
                    >
                      <option value="">Selecciona un hijo</option>
                      {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Nombre Autorizado</label>
                    <input 
                      required
                      type="text" 
                      placeholder="Ej. Juan Pérez"
                      value={newAuth.name}
                      onChange={e => setNewAuth({...newAuth, name: e.target.value})}
                      className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500/20 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-2">DNI (Opcional)</label>
                    <input 
                      type="text" 
                      placeholder="Documento de identidad"
                      value={newAuth.dni}
                      onChange={e => setNewAuth({...newAuth, dni: e.target.value})}
                      className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500/20 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Expira (Opcional)</label>
                    <input 
                      type="datetime-local" 
                      value={newAuth.expiresAt}
                      onChange={e => setNewAuth({...newAuth, expiresAt: e.target.value})}
                      className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500/20 transition-all"
                    />
                  </div>
                  <div className="pt-4 flex gap-3">
                    <Button variant="secondary" className="flex-1" onClick={() => setIsAuthModalOpen(false)}>Cancelar</Button>
                    <Button type="submit" className="flex-1">Generar QR</Button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
    </div>
  );
};

const SchoolDashboard = () => {
  const { user, logout } = useAuth();
  const { addNotification } = useNotifications();
  const [comms, setComms] = useState<Communication[]>([]);
  const [auths, setAuths] = useState<Authorization[]>([]);
  const [allStudents, setAllStudents] = useState<Student[]>([]);
  const [school, setSchool] = useState<School | null>(null);
  const [editingComm, setEditingComm] = useState<Communication | null>(null);
  const [isEditCommModalOpen, setIsEditCommModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'scanner' | 'comms' | 'calendar' | 'students'>('scanner');
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [newComm, setNewComm] = useState({ 
    title: '', 
    content: '', 
    category: 'info' as 'info' | 'urgent' | 'event', 
    deadline: '', 
    targetGrades: [] as string[],
    isImportant: false,
    location: ''
  });
  const [newEvent, setNewEvent] = useState({ title: '', content: '', date: '', location: '', category: 'event' as 'event' | 'urgent' });
  const [isQRModalOpen, setIsQRModalOpen] = useState(false);
  const [isConfirmPickupModalOpen, setIsConfirmPickupModalOpen] = useState(false);
  const [scanResult, setScanResult] = useState<Authorization | null>(null);
  const [scannedStudent, setScannedStudent] = useState<Student | null>(null);
  const [scannedParent, setScannedParent] = useState<UserProfile | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('all');

  const handleDeleteAuth = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'authorizations', id));
      addNotification({
        title: 'Eliminado',
        content: 'Registro de retiro eliminado con éxito',
        category: 'info',
        isImportant: false
      });
    } catch (error) {
      handleFirestoreError(error, FirestoreOperationType.DELETE, `authorizations/${id}`);
    }
  };

  useEffect(() => {
    const fetchDetails = async () => {
      if (scanResult) {
        try {
          // Fetch Student
          if (scanResult.studentId) {
            const studentDoc = await getDoc(doc(db, 'students', scanResult.studentId));
            if (studentDoc.exists()) {
              setScannedStudent({ id: studentDoc.id, ...studentDoc.data() } as Student);
            }
          }
          // Fetch Parent
          if (scanResult.parentId) {
            const parentDoc = await getDoc(doc(db, 'users', scanResult.parentId));
            if (parentDoc.exists()) {
              setScannedParent({ id: parentDoc.id, ...parentDoc.data() } as UserProfile);
            }
          }
        } catch (error) {
          console.error("Error fetching scan details:", error);
        }
      } else {
        setScannedStudent(null);
        setScannedParent(null);
      }
    };
    fetchDetails();
  }, [scanResult]);

  useEffect(() => {
    if (!user?.uid || !auth.currentUser) return;

    // Fetch communications
    const qComms = query(collection(db, 'communications'), where('schoolId', '==', user.schoolId || 'default-school'));
    const unsubComms = onSnapshot(qComms, (snapshot) => {
      const newComms = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Communication));
      
      // Notify staff of new parent-submitted events
      snapshot.docChanges().forEach(change => {
        if (change.type === 'added') {
          const data = change.doc.data() as Communication;
          const isRecent = new Date(data.date).getTime() > Date.now() - 10000;
          // If it's an event from a parent, notify staff
          if (isRecent && data.category === 'event' && data.authorId !== user.uid) {
            addNotification({
              title: `Nueva Solicitud: ${data.title}`,
              content: `Un padre ha solicitado un evento: ${data.content}`,
              category: 'event',
              isImportant: true
            });
          }
        }
      });

      setComms(newComms);
    }, (error) => handleFirestoreError(error, FirestoreOperationType.LIST, 'communications'));

    // Fetch authorizations for the day
    const qAuths = query(collection(db, 'authorizations'), where('schoolId', '==', user.schoolId || 'default-school'));
    const unsubAuths = onSnapshot(qAuths, (snapshot) => {
      const now = new Date();
      const updatedAuths = snapshot.docs.map(docSnap => {
        const data = docSnap.data() as Authorization;
        const id = docSnap.id;
        
        // Auto-expire check
        if (data.status === 'pending' && data.expiresAt && new Date(data.expiresAt) < now) {
          updateDoc(doc(db, 'authorizations', id), { status: 'expired' });
          return { ...data, id, status: 'expired' } as Authorization;
        }
        
        return { id, ...data } as Authorization;
      });
      setAuths(updatedAuths);
    }, (error) => handleFirestoreError(error, FirestoreOperationType.LIST, 'authorizations'));

    // Fetch all students for the school
    const qAllStudents = query(collection(db, 'students'), where('schoolId', '==', user.schoolId || 'default-school'));
    const unsubAllStudents = onSnapshot(qAllStudents, (snapshot) => {
      const studentsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Student));
      setAllStudents(studentsData);
    }, (error) => handleFirestoreError(error, FirestoreOperationType.LIST, 'students'));

    // Fetch school info
    let unsubSchool = () => {};
    if (user.schoolId) {
      unsubSchool = onSnapshot(doc(db, 'schools', user.schoolId), (docSnap) => {
        if (docSnap.exists()) {
          setSchool({ id: docSnap.id, ...docSnap.data() } as School);
        }
      }, (error) => handleFirestoreError(error, FirestoreOperationType.GET, `schools/${user.schoolId}`));
    }

    return () => {
      unsubComms();
      unsubAuths();
      unsubAllStudents();
      unsubSchool();
    };
  }, [user?.uid, user?.schoolId, auth.currentUser]);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user?.schoolId) return;

    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64 = reader.result as string;
      try {
        await updateDoc(doc(db, 'schools', user.schoolId!), {
          logoUrl: base64
        });
        addNotification({
          title: 'Logo Actualizado',
          content: 'El logo del colegio ha sido actualizado',
          category: 'info',
          isImportant: false
        });
      } catch (error) {
        handleFirestoreError(error, FirestoreOperationType.UPDATE, `schools/${user.schoolId}`);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleUpdateComm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !editingComm || !auth.currentUser) return;

    try {
      await updateDoc(doc(db, 'communications', editingComm.id), {
        title: editingComm.title,
        content: editingComm.content,
        category: editingComm.category,
        deadline: editingComm.deadline || '',
        location: editingComm.location || ''
      });
      setIsEditCommModalOpen(false);
      setEditingComm(null);
      addNotification({
        title: 'Actualizado',
        content: 'Comunicación actualizada con éxito',
        category: 'info',
        isImportant: false
      });
    } catch (error) {
      handleFirestoreError(error, FirestoreOperationType.UPDATE, `communications/${editingComm.id}`);
    }
  };

  const handleCreateComm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newComm.title || !newComm.content || !auth.currentUser) return;

    const summary = await summarizeCommunication(newComm.content);

    try {
      const isUrgent = newComm.category === 'urgent';
      const commData: Omit<Communication, 'id'> = {
        schoolId: user.schoolId || 'default',
        title: newComm.title,
        content: newComm.content,
        date: new Date().toISOString(),
        summary,
        category: newComm.category,
        isImportant: isUrgent || newComm.isImportant,
        deadline: newComm.deadline || undefined,
        targetGrades: newComm.targetGrades.length > 0 ? newComm.targetGrades : undefined,
        location: newComm.location || undefined
      };

      await addDoc(collection(db, 'communications'), {
        ...commData,
        authorId: user.uid,
        readBy: []
      });
      setNewComm({ title: '', content: '', category: 'info', deadline: '', targetGrades: [], isImportant: false, location: '' });
      addNotification({
        title: 'Éxito',
        content: 'Comunicado enviado con éxito',
        category: 'info',
        isImportant: false
      });
    } catch (error) {
      handleFirestoreError(error, FirestoreOperationType.CREATE, 'communications');
    }
  };

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newEvent.title || !newEvent.date || !auth.currentUser) return;

    try {
      await addDoc(collection(db, 'communications'), {
        schoolId: user.schoolId || 'default-school',
        title: newEvent.title,
        content: newEvent.content,
        date: new Date().toISOString(),
        deadline: new Date(newEvent.date).toISOString(),
        location: newEvent.location,
        category: newEvent.category,
        authorId: user.uid,
        isImportant: newEvent.category === 'urgent',
        readBy: []
      });
      setIsEventModalOpen(false);
      setNewEvent({ title: '', content: '', date: '', location: '', category: 'event' });
      addNotification({
        title: 'Éxito',
        content: 'Evento creado con éxito',
        category: 'info',
        isImportant: false
      });
    } catch (error) {
      handleFirestoreError(error, FirestoreOperationType.CREATE, 'communications');
    }
  };

  const handleScan = async (code: string) => {
    if (!code) return;
    try {
      // Fetch directly from Firestore to ensure we have the latest status
      const q = query(
        collection(db, 'authorizations'), 
        where('qrCode', '==', code),
        where('schoolId', '==', user?.schoolId || 'default-school')
      );
      const querySnapshot = await getDocs(q);
      
      if (!querySnapshot.empty) {
        const authDoc = { id: querySnapshot.docs[0].id, ...querySnapshot.docs[0].data() } as Authorization;
        
        if (authDoc.status === 'used') {
          alert("Este código ya fue utilizado y no es válido para un nuevo retiro.");
          return;
        }
        
        const now = new Date();
        if (authDoc.status === 'expired' || (authDoc.expiresAt && new Date(authDoc.expiresAt) < now)) {
          // Update status in Firestore if it was pending but expired
          if (authDoc.status === 'pending') {
            await updateDoc(doc(db, 'authorizations', authDoc.id), { status: 'expired' });
          }
          alert("Este código ha VENCIDO porque se ha pasado la fecha/hora límite indicada para retirar al alumno.");
          return;
        }
        
        setScanResult(authDoc);
      } else {
        alert("Código no reconocido. Por favor, verifique que el código sea correcto o solicite uno nuevo al padre.");
      }
    } catch (error) {
      handleFirestoreError(error, FirestoreOperationType.GET, 'authorizations');
    }
  };

  const confirmPickup = async () => {
    if (!scanResult) return;
    try {
      await updateDoc(doc(db, 'authorizations', scanResult.id), { status: 'used' });
      setScanResult(null);
      setManualCode('');
      setIsConfirmPickupModalOpen(false);
      alert("Retiro confirmado con éxito");
    } catch (error) {
      handleFirestoreError(error, FirestoreOperationType.UPDATE, `authorizations/${scanResult.id}`);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <Logo size={40} />
          <h1 className="font-bold text-xl tracking-tight">Nexo</h1>
        </div>
        <div className="flex items-center gap-4">
          <label className="cursor-pointer group relative">
            {school?.logoUrl ? (
              <div className="w-10 h-10 rounded-lg overflow-hidden border border-slate-200">
                <img src={school.logoUrl} className="w-full h-full object-contain" alt="School Logo" referrerPolicy="no-referrer" />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity rounded-lg">
                  <Camera size={16} className="text-white" />
                </div>
              </div>
            ) : (
              <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400 border border-dashed border-slate-300 hover:bg-slate-200 transition-colors">
                <Plus size={20} />
              </div>
            )}
            <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
          </label>
          <ThemeToggle />
          <NotificationToggle />
          {user && <UserProfileAvatar user={user} />}
          <div className="text-right hidden sm:block">
            <p className="text-sm font-bold">{user?.name}</p>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Personal Administrativo</p>
          </div>
          <Button variant="ghost" onClick={logout} className="p-2">
            <LogOut size={20} />
          </Button>
        </div>
      </header>

      {/* Navigation */}
      <div className="bg-white border-b border-slate-200 px-4 sm:px-6 flex flex-col sm:flex-row items-stretch sm:items-center gap-1 sm:gap-8 py-2 sm:py-0">
        <button 
          onClick={() => setActiveTab('scanner')}
          className={`py-3 sm:py-4 px-4 sm:px-2 font-bold text-sm transition-all border-l-4 sm:border-l-0 sm:border-b-2 text-left sm:text-center rounded-r-lg sm:rounded-none ${activeTab === 'scanner' ? 'border-indigo-600 text-indigo-600 bg-indigo-50 sm:bg-transparent' : 'border-transparent text-slate-500 hover:text-indigo-400 hover:bg-slate-50 sm:hover:bg-transparent'}`}
        >
          Retiros e Historial
        </button>
        <button 
          onClick={() => setActiveTab('comms')}
          className={`py-3 sm:py-4 px-4 sm:px-2 font-bold text-sm transition-all border-l-4 sm:border-l-0 sm:border-b-2 text-left sm:text-center rounded-r-lg sm:rounded-none flex items-center justify-between sm:justify-center gap-2 ${activeTab === 'comms' ? 'border-emerald-600 text-emerald-600 bg-emerald-50 sm:bg-transparent' : 'border-transparent text-slate-500 hover:text-emerald-400 hover:bg-slate-50 sm:hover:bg-transparent'}`}
        >
          <span>Comunicados</span>
          {comms.filter(c => (c.category === 'event' || c.category === 'message') && c.authorId !== user.uid).length > 0 && (
            <span className="bg-rose-500 text-white text-[10px] px-2 py-0.5 rounded-full">
              {comms.filter(c => (c.category === 'event' || c.category === 'message') && c.authorId !== user.uid).length}
            </span>
          )}
        </button>
        <button 
          onClick={() => setActiveTab('calendar')}
          className={`py-3 sm:py-4 px-4 sm:px-2 font-bold text-sm transition-all border-l-4 sm:border-l-0 sm:border-b-2 text-left sm:text-center rounded-r-lg sm:rounded-none ${activeTab === 'calendar' ? 'border-violet-600 text-violet-600 bg-violet-50 sm:bg-transparent' : 'border-transparent text-slate-500 hover:text-violet-400 hover:bg-slate-50 sm:hover:bg-transparent'}`}
        >
          Calendario
        </button>
        <button 
          onClick={() => setActiveTab('students')}
          className={`py-3 sm:py-4 px-4 sm:px-2 font-bold text-sm transition-all border-l-4 sm:border-l-0 sm:border-b-2 text-left sm:text-center rounded-r-lg sm:rounded-none ${activeTab === 'students' ? 'border-amber-600 text-amber-600 bg-amber-50 sm:bg-transparent' : 'border-transparent text-slate-500 hover:text-amber-400 hover:bg-slate-50 sm:hover:bg-transparent'}`}
        >
          Alumnos y Cursos
        </button>
      </div>

      {/* Content */}
      <main className="flex-1 p-6 max-w-4xl mx-auto w-full">
        <AnimatePresence mode="wait">
          {activeTab === 'scanner' && (
            <motion.div 
              key="scanner"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <h2 className="text-2xl font-bold">Validación de Retiro</h2>
              
              <Card className="flex flex-col items-center py-12">
                <div className="w-24 h-24 bg-indigo-50 rounded-full flex items-center justify-center text-indigo-600 mb-6">
                  <Scan size={48} />
                </div>
                <h3 className="text-xl font-bold mb-2">Escanear Código QR</h3>
                <p className="text-slate-500 text-center max-w-xs mb-8">
                  Apunta la cámara al código generado por el padre o ingresa el código manualmente.
                </p>
                
                <div className="w-full max-w-xs space-y-4">
                  <Button 
                    className="w-full py-6 text-lg font-bold rounded-2xl shadow-lg shadow-indigo-200 flex items-center justify-center gap-3"
                    onClick={() => setIsQRModalOpen(true)}
                  >
                    <QrCode size={24} />
                    Escanear Código QR
                  </Button>

                  <div className="relative py-4">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t border-slate-200"></span>
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-white px-2 text-slate-400 font-bold">O ingresa manualmente</span>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      placeholder="Código manual..."
                      value={manualCode}
                      onChange={e => setManualCode(e.target.value)}
                      className="flex-1 px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500/20 transition-all"
                    />
                    <Button onClick={() => handleScan(manualCode)}>Validar</Button>
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    <Button variant="ghost" className="py-4 border border-slate-200" onClick={() => {
                      const lastAuth = auths.filter(a => a.status === 'pending')[0];
                      if (lastAuth) {
                        setManualCode(lastAuth.qrCode);
                        handleScan(lastAuth.qrCode);
                      } else {
                        alert("No hay autorizaciones pendientes para simular.");
                      }
                    }}>
                      Simular con último QR
                    </Button>
                  </div>
                </div>
              </Card>

              {scanResult && (
                <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
                  <Card className="border-4 border-emerald-500 bg-emerald-50/50 shadow-xl overflow-hidden relative">
                    <div className="absolute top-0 right-0 p-4">
                      <Badge variant="success" className="text-lg px-4 py-1 animate-pulse">VALIDADO</Badge>
                    </div>
                    
                    <div className="flex items-center gap-4 mb-8">
                      <div className="w-20 h-20 bg-emerald-100 rounded-3xl flex items-center justify-center text-emerald-600 shadow-inner">
                        <CheckCircle size={40} />
                      </div>
                      <div>
                        <h4 className="text-2xl font-black text-emerald-900 tracking-tight">¡Autorización Validada!</h4>
                        <p className="text-emerald-700 font-medium">Por favor, corrobore los datos del autorizado</p>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 bg-white/60 p-6 rounded-2xl border border-emerald-100 mb-8">
                      <div className="space-y-1">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Alumno a Retirar</p>
                        <p className="font-bold text-xl text-slate-900">{scannedStudent?.name || 'Cargando...'}</p>
                        <p className="text-xs text-slate-500">{scannedStudent?.grade} - {scannedStudent?.class}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Padre/Madre que Autoriza</p>
                        <p className="font-bold text-xl text-slate-900">{scannedParent?.name || 'Cargando...'}</p>
                        <p className="text-xs text-slate-500">{scannedParent?.email}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Persona Autorizada para Retiro</p>
                        <p className="font-bold text-xl text-indigo-600">{scanResult.authorizedPersonName}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="secondary" className="font-mono">{scanResult.authorizedPersonDni || 'DNI no registrado'}</Badge>
                          <span className="text-[10px] text-slate-400 font-bold uppercase">Documento de Identidad</span>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Vencimiento de Autorización</p>
                        <p className="font-bold text-slate-700">{format(new Date(scanResult.expiresAt || scanResult.date), "dd 'de' MMMM, HH:mm'hs'", { locale: es })}</p>
                        <div className="flex items-center gap-2 text-emerald-600 font-bold text-xs mt-1">
                          <div className="w-2 h-2 bg-emerald-500 rounded-full animate-ping" />
                          Código Activo y Válido
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex gap-4">
                      <Button variant="secondary" className="flex-1 py-6 rounded-2xl font-bold" onClick={() => setScanResult(null)}>
                        Cancelar
                      </Button>
                      <Button variant="success" className="flex-[2] py-6 rounded-2xl font-black text-lg shadow-lg shadow-emerald-200" onClick={() => setIsConfirmPickupModalOpen(true)}>
                        Confirmar Entrega de Alumno
                      </Button>
                    </div>
                  </Card>
                </motion.div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mt-12 mb-6">
                <h2 className="text-2xl font-bold">Historial de Retiros</h2>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                  <input 
                    type="text" 
                    placeholder="Buscar por nombre..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/20 transition-all w-full sm:w-64"
                  />
                </div>
              </div>

              <div className="space-y-4">
                {auths
                  .filter(a => a.status === 'used')
                  .filter(a => a.authorizedPersonName.toLowerCase().includes(searchQuery.toLowerCase()))
                  .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                  .map(auth => (
                    <Card key={`school-auth-${auth.id}`} className="flex items-center justify-between group">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-600">
                          <CheckCircle size={24} />
                        </div>
                        <div>
                          <h4 className="font-bold">{auth.authorizedPersonName}</h4>
                          <p className="text-xs text-slate-500">Retiró a un alumno el {format(new Date(auth.date), 'dd/MM/yyyy HH:mm')}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge variant="success">Completado</Badge>
                        <button 
                          onClick={() => handleDeleteAuth(auth.id)}
                          className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                          title="Eliminar"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </Card>
                  ))}
                
                {auths.filter(a => a.status === 'used').length === 0 && (
                  <Card className="text-center py-12">
                    <Clock size={48} className="mx-auto text-slate-200 mb-4" />
                    <p className="text-slate-500 font-medium">No hay retiros registrados hoy</p>
                  </Card>
                )}
              </div>
            </motion.div>
          )}

          {activeTab === 'comms' && (
            <motion.div 
              key="comms"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold">Interacciones con Padres</h2>
                <Badge variant="info">{comms.filter(c => (c.category === 'event' || c.category === 'message') && c.authorId !== user.uid).length} Pendientes</Badge>
              </div>

              <div className="space-y-4">
                {comms
                  .filter(c => (c.category === 'event' || c.category === 'message') && c.authorId !== user.uid)
                  .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                  .map(comm => (
                    <Card key={`school-interaction-${comm.id}`} className={`border-l-4 ${comm.category === 'event' ? 'border-l-indigo-500' : 'border-l-emerald-500'}`}>
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-lg">{comm.title}</h4>
                          <Badge variant={comm.category === 'event' ? 'info' : 'success'}>
                            {comm.category === 'event' ? 'Solicitud de Evento' : 'Mensaje'}
                          </Badge>
                        </div>
                        <span className="text-[10px] font-bold text-slate-400 uppercase">
                          {format(new Date(comm.date), 'dd/MM/yyyy HH:mm')}
                        </span>
                      </div>
                      <p className="text-slate-600 text-sm mb-4">{comm.content}</p>
                      
                      {comm.deadline && (
                        <div className="flex items-center gap-2 mb-4 p-2 bg-indigo-50 rounded-lg text-indigo-700 text-xs font-medium">
                          <CalendarIcon size={14} />
                          Fecha solicitada: {format(new Date(comm.deadline), "d 'de' MMMM, HH:mm", { locale: es })}
                        </div>
                      )}

                      <div className="flex items-center justify-between pt-4 border-t border-slate-50">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center text-slate-400">
                            <User size={16} />
                          </div>
                          <span className="text-xs font-medium text-slate-500">Enviado por un padre</span>
                        </div>
                        <div className="flex gap-2">
                          <Button variant="secondary" size="sm" onClick={() => {
                            addNotification({
                              title: 'Aceptado',
                              content: 'Has aceptado la solicitud',
                              category: 'info',
                              isImportant: false
                            });
                          }}>
                            Aceptar
                          </Button>
                          <Button variant="primary" size="sm" onClick={() => {
                            addNotification({
                              title: 'Respuesta enviada',
                              content: 'Se ha enviado tu respuesta al padre',
                              category: 'info',
                              isImportant: false
                            });
                          }}>
                            Responder
                          </Button>
                        </div>
                      </div>
                    </Card>
                  ))}
                
                {comms.filter(c => (c.category === 'event' || c.category === 'message') && c.authorId !== user.uid).length === 0 && (
                  <Card className="text-center py-12">
                    <Inbox size={48} className="mx-auto text-slate-200 mb-4" />
                    <p className="text-slate-500 font-medium">No hay mensajes o solicitudes pendientes</p>
                  </Card>
                )}
              </div>

              <h2 className="text-2xl font-bold mt-12">Nuevo Comunicado</h2>
              <Card>
                <form onSubmit={handleCreateComm} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Título</label>
                      <input 
                        required
                        type="text" 
                        placeholder="Ej. Reunión de Padres"
                        value={newComm.title}
                        onChange={e => setNewComm({...newComm, title: e.target.value})}
                        className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500/20 transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Categoría</label>
                      <select 
                        value={newComm.category}
                        onChange={e => setNewComm({...newComm, category: e.target.value as any})}
                        className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500/20 transition-all"
                      >
                        <option value="info">Informativo</option>
                        <option value="urgent">Urgente</option>
                        <option value="event">Evento</option>
                      </select>
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Mensaje</label>
                    <textarea 
                      required
                      rows={4}
                      placeholder="Escribe el comunicado aquí..."
                      value={newComm.content}
                      onChange={e => setNewComm({...newComm, content: e.target.value})}
                      className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500/20 transition-all resize-none"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Fecha Límite (Opcional)</label>
                      <input 
                        type="datetime-local" 
                        value={newComm.deadline}
                        onChange={e => setNewComm({...newComm, deadline: e.target.value})}
                        className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500/20 transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Ubicación (Opcional)</label>
                      <input 
                        type="text" 
                        placeholder="Ej. Salón de Actos"
                        value={newComm.location}
                        onChange={e => setNewComm({...newComm, location: e.target.value})}
                        className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500/20 transition-all"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Grados Destino (Separa por coma)</label>
                    <input 
                      type="text" 
                      placeholder="Ej. 1A, 2B, 3C"
                      onChange={e => setNewComm({...newComm, targetGrades: e.target.value.split(',').map(s => s.trim())})}
                      className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500/20 transition-all"
                    />
                  </div>

                  <div className="flex items-center gap-2 py-2">
                    <input 
                      type="checkbox" 
                      id="isImportant"
                      checked={newComm.isImportant}
                      onChange={e => setNewComm({...newComm, isImportant: e.target.checked})}
                      className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
                    />
                    <label htmlFor="isImportant" className="text-sm font-medium text-slate-700">
                      Marcar como importante (Prioridad Alta)
                    </label>
                  </div>

                  <Button type="submit" className="w-full py-4">
                    <Bell size={20} />
                    Enviar a todos los padres
                  </Button>
                </form>
              </Card>

              <h3 className="text-xl font-bold mt-8">Enviados Recientemente</h3>
              <div className="space-y-4">
                {comms.filter(c => c.authorId === user.uid).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map(comm => (
                  <Card key={`school-comm-${comm.id}`} className="flex justify-between items-center">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-bold">{comm.title}</h4>
                        <Badge variant={comm.category === 'urgent' ? 'danger' : comm.category === 'event' ? 'info' : 'default'}>
                          {comm.category || 'info'}
                        </Badge>
                      </div>
                      <p className="text-xs text-slate-500">{format(new Date(comm.date), 'dd/MM/yyyy HH:mm')}</p>
                      {comm.location && <p className="text-[10px] text-indigo-600 mt-1">📍 {comm.location}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-[10px]" onClick={() => { setEditingComm(comm); setIsEditCommModalOpen(true); }}>
                        <Edit size={12} />
                        Editar
                      </Button>
                      {comm.category === 'event' && (
                        <Button variant="ghost" size="sm" onClick={() => addToCalendar(comm)} className="text-indigo-600">
                          <CalendarIcon size={16} />
                        </Button>
                      )}
                      <Badge variant="info">Enviado</Badge>
                    </div>
                  </Card>
                ))}
              </div>
            </motion.div>
          )}



          {activeTab === 'students' && (
            <motion.div 
              key="students"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <h2 className="text-2xl font-bold">Alumnos y Cursos</h2>
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                  <input 
                    type="text" 
                    placeholder="Buscar alumno..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/20 transition-all w-full"
                  />
                </div>
              </div>

              {Object.entries(
                allStudents
                  .filter(s => s.name.toLowerCase().includes(searchQuery.toLowerCase()))
                  .reduce((acc, student) => {
                    const key = `${student.grade || 'Sin Grado'} - ${student.class || 'Sin Sección'}`;
                    if (!acc[key]) acc[key] = [];
                    acc[key].push(student);
                    return acc;
                  }, {} as Record<string, Student[]>)
              )
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([courseName, students]) => (
                <Card key={`course-${courseName}`} className="p-0 overflow-hidden mb-4">
                  <div className="bg-slate-50 px-6 py-3 border-b border-slate-200 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <BookOpen size={18} className="text-indigo-600" />
                      <h3 className="font-bold text-slate-700">{courseName}</h3>
                    </div>
                    <Badge variant="default">{students.length} Alumnos</Badge>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {students.sort((a, b) => a.name.localeCompare(b.name)).map(student => (
                      <div key={`student-row-${student.id}`} className="px-6 py-3 flex items-center justify-between hover:bg-slate-50/50 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-slate-400 overflow-hidden">
                            {student.photoUrl ? (
                              <img src={student.photoUrl} className="w-full h-full object-cover" alt={student.name} />
                            ) : (
                              <User size={16} />
                            )}
                          </div>
                          <p className="text-sm font-medium">{student.name}</p>
                        </div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase">ID: {student.id.slice(0, 8)}</p>
                      </div>
                    ))}
                  </div>
                </Card>
              ))}
              
              {allStudents.length === 0 && (
                <Card className="text-center py-12">
                  <Users size={48} className="mx-auto text-slate-200 mb-4" />
                  <p className="text-slate-500 font-medium">No hay alumnos registrados en este colegio</p>
                </Card>
              )}
            </motion.div>
          )}

          {activeTab === 'calendar' && (
            <motion.div 
              key="calendar"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold">Calendario de Eventos</h2>
                <Button onClick={() => setIsEventModalOpen(true)}>Nuevo Evento</Button>
              </div>
              <div className="grid grid-cols-1 gap-4">
                {comms.filter(c => c.category === 'event' || c.deadline).sort((a, b) => new Date(a.deadline || a.date).getTime() - new Date(b.deadline || b.date).getTime()).map(event => (
                  <Card key={`cal-admin-${event.id}`} className="flex gap-4 items-start">
                    <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex flex-col items-center justify-center text-white shrink-0">
                      <span className="text-[10px] font-bold uppercase">{format(new Date(event.deadline || event.date), 'MMM', { locale: es })}</span>
                      <span className="text-xl font-bold">{format(new Date(event.deadline || event.date), 'dd')}</span>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-bold text-lg">{event.title}</h4>
                        <Badge variant={event.category === 'urgent' ? 'danger' : 'default'}>{event.category}</Badge>
                        {event.authorId !== user.uid && <Badge variant="secondary">Padre</Badge>}
                      </div>
                      <p className="text-sm text-slate-600">{event.content}</p>
                      {event.location && (
                        <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                          <Home size={12} />
                          {event.location}
                        </p>
                      )}
                      <div className="flex items-center gap-4 mt-3">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                          <CalendarIcon size={12} />
                          {format(new Date(event.deadline || event.date), "EEEE d 'de' MMMM", { locale: es })}
                        </span>
                        <Button variant="ghost" size="sm" className="text-indigo-600 p-0 h-auto" onClick={() => addToCalendar(event)}>
                          Agendar
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
                {comms.filter(c => c.category === 'event' || c.deadline).length === 0 && (
                  <Card className="text-center py-12">
                    <CalendarIcon size={48} className="mx-auto text-slate-200 mb-4" />
                    <p className="text-slate-500 font-medium">No hay eventos registrados</p>
                  </Card>
                )}
              </div>

              {/* Event Modal */}
              <AnimatePresence>
                {isEventModalOpen && (
                  <div key="school-event-modal" className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      onClick={() => setIsEventModalOpen(false)}
                      className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
                    />
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="bg-white w-full max-w-md rounded-3xl p-8 shadow-2xl relative z-10"
                    >
                      <h3 className="text-xl font-bold mb-6">Crear Nuevo Evento</h3>
                      <form onSubmit={handleCreateEvent} className="space-y-4">
                        <div>
                          <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Título</label>
                          <input 
                            required
                            type="text" 
                            placeholder="Ej. Excursión al Museo"
                            value={newEvent.title}
                            onChange={e => setNewEvent({...newEvent, title: e.target.value})}
                            className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500/20 transition-all"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Fecha y Hora</label>
                            <input 
                              required
                              type="datetime-local" 
                              value={newEvent.date}
                              onChange={e => setNewEvent({...newEvent, date: e.target.value})}
                              className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500/20 transition-all"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Categoría</label>
                            <select 
                              value={newEvent.category}
                              onChange={e => setNewEvent({...newEvent, category: e.target.value as any})}
                              className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500/20 transition-all"
                            >
                              <option value="event">Evento Normal</option>
                              <option value="urgent">Urgente / Importante</option>
                            </select>
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Ubicación</label>
                          <input 
                            type="text" 
                            placeholder="Ej. Patio Principal"
                            value={newEvent.location}
                            onChange={e => setNewEvent({...newEvent, location: e.target.value})}
                            className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500/20 transition-all"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Descripción</label>
                          <textarea 
                            required
                            placeholder="Detalles del evento..."
                            value={newEvent.content}
                            onChange={e => setNewEvent({...newEvent, content: e.target.value})}
                            className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500/20 transition-all resize-none"
                            rows={3}
                          />
                        </div>
                        <div className="pt-4 flex gap-3">
                          <Button variant="secondary" className="flex-1" onClick={() => setIsEventModalOpen(false)}>Cancelar</Button>
                          <Button type="submit" className="flex-1">Crear Evento</Button>
                        </div>
                      </form>
                    </motion.div>
                  </div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <QRScannerModal 
        isOpen={isQRModalOpen} 
        onClose={() => setIsQRModalOpen(false)} 
        onScanSuccess={(code) => handleScan(code)} 
      />

      <AnimatePresence>
        {isConfirmPickupModalOpen && scanResult && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-[32px] w-full max-w-md p-8 shadow-2xl text-center"
            >
              <div className="w-20 h-20 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-6">
                <AlertCircle size={40} />
              </div>
              <h3 className="text-2xl font-black text-slate-900 mb-2">¿Confirmar Retiro?</h3>
              <p className="text-slate-600 mb-8">
                ¿Está seguro que desea confirmar la entrega de <strong className="text-slate-900">{scannedStudent?.name}</strong> a <strong className="text-slate-900">{scanResult.authorizedPersonName}</strong>? Esta acción no se puede deshacer.
              </p>
              <div className="flex gap-3">
                <Button variant="secondary" className="flex-1 py-4" onClick={() => setIsConfirmPickupModalOpen(false)}>
                  Cancelar
                </Button>
                <Button variant="success" className="flex-1 py-4" onClick={confirmPickup}>
                  Sí, Confirmar
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: any }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
          <div className="bg-white p-8 rounded-3xl shadow-xl max-w-md w-full text-center">
            <div className="w-16 h-16 bg-rose-100 text-rose-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <AlertCircle size={32} />
            </div>
            <h2 className="text-2xl font-bold mb-2">Algo salió mal</h2>
            <p className="text-slate-500 mb-6 font-medium">
              Ocurrió un error inesperado. Por favor, intenta recargar la página.
            </p>
            <Button onClick={() => window.location.reload()} className="w-full">
              Recargar Página
            </Button>
            {this.state.error && (
              <pre className="mt-6 p-4 bg-slate-50 rounded-xl text-[10px] text-left overflow-auto max-h-40 text-slate-400">
                {JSON.stringify(this.state.error, null, 2)}
              </pre>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <NotificationProvider>
          <AppContent />
        </NotificationProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}

const AdminDashboard = () => {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<'overview' | 'schools' | 'users' | 'monitoring'>('overview');
  const [schools, setSchools] = useState<School[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [stats, setStats] = useState({ totalSchools: 0, totalUsers: 0, totalStudents: 0, activeAuthorizations: 0 });
  const [isSchoolModalOpen, setIsSchoolModalOpen] = useState(false);
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [newSchool, setNewSchool] = useState({ name: '', address: '' });
  const [newUser, setNewUser] = useState({ name: '', email: '', role: 'parent' as 'parent' | 'school' | 'admin', schoolId: '' });
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);

  useEffect(() => {
    if (user?.role !== 'admin' || !auth.currentUser) return;

    const ensureDefaultSchool = async () => {
      try {
        const schoolDoc = await getDoc(doc(db, 'schools', 'default-school'));
        if (!schoolDoc.exists()) {
          await setDoc(doc(db, 'schools', 'default-school'), {
            name: 'Colegio Nexo Internacional',
            address: 'Av. de las Familias 123, Ciudad Educativa',
            logoUrl: 'https://picsum.photos/seed/school/200/200',
            phone: '+1 234 567 890',
            email: 'contacto@nexo.edu',
            website: 'www.nexo.edu'
          });
        }
      } catch (error) {
        // Silent fail if permissions missing during initial load
        if (error instanceof Error && !error.message.includes('insufficient permissions')) {
          console.error("Error ensuring default school:", error);
        }
      }
    };
    ensureDefaultSchool();

    // Fetch schools
    const unsubSchools = onSnapshot(collection(db, 'schools'), (snapshot) => {
      setSchools(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as School)));
    }, (error) => handleFirestoreError(error, FirestoreOperationType.LIST, 'schools'));

    // Fetch users
    const unsubUsers = onSnapshot(collection(db, 'users'), (snapshot) => {
      setUsers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as unknown as UserProfile)));
    }, (error) => handleFirestoreError(error, FirestoreOperationType.LIST, 'users'));

    // Fetch stats (simplified)
    const unsubStudents = onSnapshot(collection(db, 'students'), (snapshot) => {
      setStats(prev => ({ ...prev, totalStudents: snapshot.size }));
    }, (error) => handleFirestoreError(error, FirestoreOperationType.LIST, 'students'));

    const unsubAuths = onSnapshot(collection(db, 'authorizations'), (snapshot) => {
      setStats(prev => ({ ...prev, activeAuthorizations: snapshot.docs.filter(d => d.data().status === 'pending').length }));
    }, (error) => handleFirestoreError(error, FirestoreOperationType.LIST, 'authorizations'));

    return () => {
      unsubSchools();
      unsubUsers();
      unsubStudents();
      unsubAuths();
    };
  }, [user, auth.currentUser]);

  useEffect(() => {
    setStats(prev => ({ ...prev, totalSchools: schools.length, totalUsers: users.length }));
  }, [schools, users]);

  const handleAddSchool = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, 'schools'), newSchool);
      setIsSchoolModalOpen(false);
      setNewSchool({ name: '', address: '' });
    } catch (error) {
      handleFirestoreError(error, FirestoreOperationType.CREATE, 'schools');
    }
  };

  const handleUpdateUserRole = async (uid: string, newRole: 'parent' | 'school' | 'admin') => {
    try {
      await updateDoc(doc(db, 'users', uid), { role: newRole });
    } catch (error) {
      handleFirestoreError(error, FirestoreOperationType.UPDATE, `users/${uid}`);
    }
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const uid = Math.random().toString(36).substr(2, 9); // Mock UID for new user
      await setDoc(doc(db, 'users', uid), {
        uid,
        ...newUser,
        schoolId: newUser.schoolId || null
      });
      setIsUserModalOpen(false);
      setNewUser({ name: '', email: '', role: 'parent', schoolId: '' });
    } catch (error) {
      handleFirestoreError(error, FirestoreOperationType.CREATE, 'users');
    }
  };

  const handleEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    try {
      await updateDoc(doc(db, 'users', editingUser.uid), {
        name: editingUser.name,
        email: editingUser.email,
        role: editingUser.role,
        schoolId: editingUser.schoolId || null
      });
      setIsUserModalOpen(false);
      setEditingUser(null);
    } catch (error) {
      handleFirestoreError(error, FirestoreOperationType.UPDATE, `users/${editingUser.uid}`);
    }
  };

  const handleDeleteUser = async (uid: string) => {
    if (!window.confirm('¿Estás seguro de eliminar este usuario?')) return;
    try {
      await deleteDoc(doc(db, 'users', uid));
    } catch (error) {
      handleFirestoreError(error, FirestoreOperationType.DELETE, `users/${uid}`);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <Logo size={40} />
          <div className="flex flex-col">
            <h1 className="font-bold text-xl tracking-tight">Nexo Admin</h1>
            <span className="text-[10px] text-indigo-600 font-bold uppercase tracking-widest">Panel de Control Global</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <ThemeToggle />
          <NotificationToggle />
          {user && <UserProfileAvatar user={user} />}
          <div className="text-right hidden sm:block">
            <p className="text-sm font-bold">{user?.name}</p>
            <p className="text-[10px] text-rose-500 font-bold uppercase tracking-widest">Super Administrador</p>
          </div>
          <Button variant="ghost" onClick={logout} className="p-2">
            <LogOut size={20} />
          </Button>
        </div>
      </header>

      {/* Navigation */}
      <div className="bg-white border-b border-slate-200 px-4 sm:px-6 flex flex-col sm:flex-row items-stretch sm:items-center gap-1 sm:gap-8 py-2 sm:py-0">
        <button 
          onClick={() => setActiveTab('overview')}
          className={`py-3 sm:py-4 px-4 sm:px-2 font-bold text-sm transition-all border-l-4 sm:border-l-0 sm:border-b-2 text-left sm:text-center rounded-r-lg sm:rounded-none flex items-center gap-2 ${activeTab === 'overview' ? 'border-indigo-600 text-indigo-600 bg-indigo-50 sm:bg-transparent' : 'border-transparent text-slate-500 hover:text-indigo-400 hover:bg-slate-50 sm:hover:bg-transparent'}`}
        >
          <Activity size={18} />
          Vista General
        </button>
        <button 
          onClick={() => setActiveTab('schools')}
          className={`py-3 sm:py-4 px-4 sm:px-2 font-bold text-sm transition-all border-l-4 sm:border-l-0 sm:border-b-2 text-left sm:text-center rounded-r-lg sm:rounded-none flex items-center gap-2 ${activeTab === 'schools' ? 'border-emerald-600 text-emerald-600 bg-emerald-50 sm:bg-transparent' : 'border-transparent text-slate-500 hover:text-emerald-400 hover:bg-slate-50 sm:hover:bg-transparent'}`}
        >
          <Database size={18} />
          Colegios
        </button>
        <button 
          onClick={() => setActiveTab('users')}
          className={`py-3 sm:py-4 px-4 sm:px-2 font-bold text-sm transition-all border-l-4 sm:border-l-0 sm:border-b-2 text-left sm:text-center rounded-r-lg sm:rounded-none flex items-center gap-2 ${activeTab === 'users' ? 'border-amber-600 text-amber-600 bg-amber-50 sm:bg-transparent' : 'border-transparent text-slate-500 hover:text-amber-400 hover:bg-slate-50 sm:hover:bg-transparent'}`}
        >
          <Users size={18} />
          Usuarios & Permisos
        </button>
        <button 
          onClick={() => setActiveTab('monitoring')}
          className={`py-3 sm:py-4 px-4 sm:px-2 font-bold text-sm transition-all border-l-4 sm:border-l-0 sm:border-b-2 text-left sm:text-center rounded-r-lg sm:rounded-none flex items-center gap-2 ${activeTab === 'monitoring' ? 'border-rose-600 text-rose-600 bg-rose-50 sm:bg-transparent' : 'border-transparent text-slate-500 hover:text-rose-400 hover:bg-slate-50 sm:hover:bg-transparent'}`}
        >
          <Shield size={18} />
          Monitoreo
        </button>
      </div>

      {/* Content */}
      <main className="flex-1 p-6 max-w-7xl mx-auto w-full">
        <AnimatePresence mode="wait">
          {activeTab === 'overview' && (
            <motion.div 
              key="overview"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"
            >
              <Card className="flex flex-col items-center text-center p-8">
                <div className="w-12 h-12 bg-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center mb-4">
                  <Database size={24} />
                </div>
                <h3 className="text-4xl font-black text-slate-900 mb-1">{stats.totalSchools}</h3>
                <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Colegios Adheridos</p>
              </Card>
              <Card className="flex flex-col items-center text-center p-8">
                <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center mb-4">
                  <Users size={24} />
                </div>
                <h3 className="text-4xl font-black text-slate-900 mb-1">{stats.totalUsers}</h3>
                <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Usuarios Totales</p>
              </Card>
              <Card className="flex flex-col items-center text-center p-8">
                <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center mb-4">
                  <BookOpen size={24} />
                </div>
                <h3 className="text-4xl font-black text-slate-900 mb-1">{stats.totalStudents}</h3>
                <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Alumnos Registrados</p>
              </Card>
              <Card className="flex flex-col items-center text-center p-8">
                <div className="w-12 h-12 bg-rose-100 text-rose-600 rounded-2xl flex items-center justify-center mb-4">
                  <QrCode size={24} />
                </div>
                <h3 className="text-4xl font-black text-slate-900 mb-1">{stats.activeAuthorizations}</h3>
                <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">QR Activos</p>
              </Card>

              <Card className="md:col-span-2 lg:col-span-4 p-8">
                <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
                  <Activity size={20} className="text-indigo-600" />
                  Estado de la Plataforma
                </h3>
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                      <span className="font-bold text-slate-700">Servicios de Autenticación</span>
                    </div>
                    <Badge variant="success">Operativo</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                      <span className="font-bold text-slate-700">Base de Datos Firestore</span>
                    </div>
                    <Badge variant="success">Operativo</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                      <span className="font-bold text-slate-700">Servicio de Notificaciones</span>
                    </div>
                    <Badge variant="success">Operativo</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                      <span className="font-bold text-slate-700">IA Assistant API</span>
                    </div>
                    <Badge variant="success">Operativo</Badge>
                  </div>
                </div>
              </Card>
            </motion.div>
          )}

          {activeTab === 'schools' && (
            <motion.div 
              key="schools"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold">Gestión de Colegios</h2>
                <Button onClick={() => setIsSchoolModalOpen(true)}>
                  <Plus size={20} />
                  Adherir Colegio
                </Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {schools.map(school => (
                  <Card key={`admin-school-${school.id}`} className="hover:shadow-md transition-all group">
                    <div className="flex items-start justify-between mb-4">
                      <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center text-slate-400 group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors">
                        <BookOpen size={24} />
                      </div>
                      <div className="flex gap-2">
                        <Button variant="ghost" className="p-2 h-auto">
                          <Edit size={16} />
                        </Button>
                        <Button variant="ghost" className="p-2 h-auto text-rose-500 hover:bg-rose-50">
                          <Trash2 size={16} />
                        </Button>
                      </div>
                    </div>
                    <h4 className="font-bold text-lg mb-1">{school.name}</h4>
                    <p className="text-sm text-slate-500 mb-4">{school.address}</p>
                    <div className="flex items-center justify-between pt-4 border-t border-slate-50">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">ID: {school.id.slice(0, 8)}...</span>
                      <Badge variant="info">Activo</Badge>
                    </div>
                  </Card>
                ))}
              </div>
            </motion.div>
          )}

          {activeTab === 'users' && (
            <motion.div 
              key="users"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold">Usuarios & Permisos</h2>
                <div className="flex items-center gap-4">
                  <div className="relative w-64">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input 
                      type="text" 
                      placeholder="Buscar usuario..."
                      className="pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/20 transition-all w-full"
                    />
                  </div>
                  <Button onClick={() => { setEditingUser(null); setIsUserModalOpen(true); }}>
                    <Plus size={20} />
                    Nuevo Usuario
                  </Button>
                </div>
              </div>

              <Card className="overflow-hidden p-0">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100">
                      <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Usuario</th>
                      <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Email</th>
                      <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Rol Actual</th>
                      <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u, idx) => (
                      <tr key={`admin-user-${u.uid || u.id || idx}`} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center font-bold text-xs">
                              {u.name.charAt(0)}
                            </div>
                            <span className="font-bold text-slate-700">{u.name}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-500">{u.email}</td>
                        <td className="px-6 py-4">
                          <Badge variant={u.role === 'admin' ? 'danger' : u.role === 'school' ? 'info' : 'default'}>
                            {u.role}
                          </Badge>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button variant="ghost" className="p-2 h-auto text-indigo-600" onClick={() => { setEditingUser(u); setIsUserModalOpen(true); }}>
                              <Edit size={16} />
                            </Button>
                            <Button variant="ghost" className="p-2 h-auto text-rose-500" onClick={() => handleDeleteUser(u.uid)}>
                              <Trash2 size={16} />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </motion.div>
          )}

          {activeTab === 'monitoring' && (
            <motion.div 
              key="monitoring"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <h2 className="text-2xl font-bold">Monitoreo de Contenido</h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card>
                  <h3 className="font-bold mb-4 flex items-center gap-2">
                    <Inbox size={18} className="text-indigo-600" />
                    Últimos Comunicados
                  </h3>
                  <div className="space-y-4">
                    {/* This would be a real list of all communications */}
                    <p className="text-sm text-slate-500 italic">Monitoreando flujo de información en tiempo real...</p>
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-bold text-indigo-600 uppercase">Colegio Central</span>
                        <span className="text-[10px] text-slate-400">Hace 5 min</span>
                      </div>
                      <p className="text-xs font-bold text-slate-700">Reunión de Padres 2do Grado</p>
                    </div>
                  </div>
                </Card>

                <Card>
                  <h3 className="font-bold mb-4 flex items-center gap-2">
                    <QrCode size={18} className="text-indigo-600" />
                    Actividad de Retiros
                  </h3>
                  <div className="space-y-4">
                    <p className="text-sm text-slate-500 italic">Seguimiento de seguridad activo...</p>
                    <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-bold text-emerald-600 uppercase">Retiro Exitoso</span>
                        <span className="text-[10px] text-slate-400">Hace 2 min</span>
                      </div>
                      <p className="text-xs font-bold text-slate-700">Alumno: Mateo García - Validado por QR</p>
                    </div>
                  </div>
                </Card>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Modals */}
      <AnimatePresence>
        {isSchoolModalOpen && (
          <div key="school-modal" className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-[32px] w-full max-w-md p-8 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold">Adherir Nuevo Colegio</h3>
                <button onClick={() => setIsSchoolModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                  <X size={24} />
                </button>
              </div>
              <form onSubmit={handleAddSchool} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Nombre del Colegio</label>
                  <input 
                    type="text" 
                    required
                    value={newSchool.name}
                    onChange={e => setNewSchool({...newSchool, name: e.target.value})}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
                    placeholder="Ej: Colegio San Martín"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Dirección</label>
                  <input 
                    type="text" 
                    required
                    value={newSchool.address}
                    onChange={e => setNewSchool({...newSchool, address: e.target.value})}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
                    placeholder="Ej: Av. Principal 123"
                  />
                </div>
                <Button type="submit" className="w-full py-4 mt-4">
                  Confirmar Adhesión
                </Button>
              </form>
            </motion.div>
          </div>
        )}

        {isUserModalOpen && (
          <div key="user-modal" className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-[32px] w-full max-w-md p-8 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold">{editingUser ? 'Editar Usuario' : 'Nuevo Usuario'}</h3>
                <button onClick={() => { setIsUserModalOpen(false); setEditingUser(null); }} className="text-slate-400 hover:text-slate-600">
                  <X size={24} />
                </button>
              </div>
              <form onSubmit={editingUser ? handleEditUser : handleAddUser} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Nombre Completo</label>
                  <input 
                    type="text" 
                    required
                    value={editingUser ? editingUser.name : newUser.name}
                    onChange={e => editingUser ? setEditingUser({...editingUser, name: e.target.value}) : setNewUser({...newUser, name: e.target.value})}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
                    placeholder="Ej: Juan Pérez"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Email</label>
                  <input 
                    type="email" 
                    required
                    value={editingUser ? editingUser.email : newUser.email}
                    onChange={e => editingUser ? setEditingUser({...editingUser, email: e.target.value}) : setNewUser({...newUser, email: e.target.value})}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
                    placeholder="email@ejemplo.com"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Rol</label>
                  <select 
                    value={editingUser ? editingUser.role : newUser.role}
                    onChange={e => editingUser ? setEditingUser({...editingUser, role: e.target.value as any}) : setNewUser({...newUser, role: e.target.value as any})}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
                  >
                    <option value="parent">Padre</option>
                    <option value="school">Colegio</option>
                    <option value="admin">Administrador</option>
                  </select>
                </div>
                {(editingUser?.role === 'school' || newUser.role === 'school') && (
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Colegio Asociado</label>
                    <select 
                      value={editingUser ? editingUser.schoolId : newUser.schoolId}
                      onChange={e => editingUser ? setEditingUser({...editingUser, schoolId: e.target.value}) : setNewUser({...newUser, schoolId: e.target.value})}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
                    >
                      <option value="">Seleccionar Colegio</option>
                      {schools.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                <Button type="submit" className="w-full py-4 mt-4">
                  {editingUser ? 'Guardar Cambios' : 'Crear Usuario'}
                </Button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
function AppContent() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full"
        />
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return (
    <>
      {user.role === 'parent' ? (
        <ParentDashboard />
      ) : user.role === 'school' ? (
        <SchoolDashboard />
      ) : (
        <AdminDashboard />
      )}
      <AISearchAssistant user={user} />
    </>
  );
}
