/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Plus, 
  Minus, 
  TrendingUp, 
  TrendingDown, 
  PieChart as ChartIcon, 
  History, 
  LayoutDashboard,
  X,
  ChevronRight,
  TrendingUp as IconIncome,
  TrendingDown as IconExpense,
  Calendar,
  AlertCircle,
  LogOut,
  User as UserIcon,
  Loader2,
  Trash2,
  Edit2,
  Target
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  format, 
  startOfWeek, 
  endOfWeek, 
  startOfMonth, 
  endOfMonth, 
  isWithinInterval, 
  subDays,
  parseISO,
  eachDayOfInterval,
  isSameDay
} from 'date-fns';
import { fr } from 'date-fns/locale';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  PieChart,
  Pie
} from 'recharts';
import { Transaction, TransactionType, CATEGORIES, Budget } from './types.ts';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { auth, db, loginWithGoogle, logout, handleRedirectResponse } from './lib/firebase.ts';
import { onAuthStateChanged, User } from 'firebase/auth';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  deleteDoc, 
  updateDoc,
  doc, 
  serverTimestamp, 
  orderBy,
  runTransaction
} from 'firebase/firestore';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [userCategories, setUserCategories] = useState<{ income: string[], expense: string[] }>({ income: [], expense: [] });
  const [userNotes, setUserNotes] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'summary' | 'history' | 'analytics' | 'budgets'>('summary');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isBudgetModalOpen, setIsBudgetModalOpen] = useState(false);
  const [modalType, setModalType] = useState<TransactionType>(TransactionType.EXPENSE);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);
  const [transactionToDelete, setTransactionToDelete] = useState<string | null>(null);
  const [budgetToDelete, setBudgetToDelete] = useState<string | null>(null);
  const [period, setPeriod] = useState<'week' | 'month'>('month');

  // Auth Listener
  useEffect(() => {
    const checkRedirect = async () => {
      setLoading(true);
      try {
        await handleRedirectResponse();
      } catch (error) {
        console.error("Redirect error:", error);
      } finally {
        // Le onAuthStateChanged prendra le relais
      }
    };
    
    checkRedirect();

    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  // Firestore Sync
  useEffect(() => {
    if (!user) {
      setTransactions([]);
      return;
    }

    const q = query(
      collection(db, 'transactions'),
      where('userId', '==', user.uid),
      orderBy('date', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Transaction));
      setTransactions(docs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'transactions');
    });

    return unsubscribe;
  }, [user]);

  // Budgets Sync
  useEffect(() => {
    if (!user) {
      setBudgets([]);
      return;
    }

    const q = query(
      collection(db, 'budgets'),
      where('userId', '==', user.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Budget));
      setBudgets(docs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'budgets');
    });

    return unsubscribe;
  }, [user]);

  // Categories Sync
  useEffect(() => {
    if (!user) {
      setUserCategories({ income: [], expense: [] });
      return;
    }

    const q = query(
      collection(db, 'categories'),
      where('userId', '==', user.uid),
      orderBy('name', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const income: string[] = [...CATEGORIES[TransactionType.INCOME]];
      const expense: string[] = [...CATEGORIES[TransactionType.EXPENSE]];
      
      snapshot.docs.forEach(d => {
        const data = d.data();
        if (data.type === TransactionType.INCOME) {
          if (!income.includes(data.name)) income.push(data.name);
        } else {
          if (!expense.includes(data.name)) expense.push(data.name);
        }
      });
      
      setUserCategories({ income, expense });
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'categories');
    });

    return unsubscribe;
  }, [user]);

  // Notes Sync
  useEffect(() => {
    if (!user) {
      setUserNotes([]);
      return;
    }

    const q = query(
      collection(db, 'notes'),
      where('userId', '==', user.uid),
      orderBy('text', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const notes = snapshot.docs.map(d => d.data().text);
      setUserNotes(notes);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'notes');
    });

    return unsubscribe;
  }, [user]);

  // Derived Stats
  const totals = useMemo(() => {
    return transactions.reduce(
      (acc, t) => {
        if (t.type === TransactionType.INCOME) acc.income += t.amount;
        else acc.expense += t.amount;
        return acc;
      },
      { income: 0, expense: 0 }
    );
  }, [transactions]);

  const balance = totals.income - totals.expense;

  const currentPeriodTransactions = useMemo(() => {
    const now = new Date();
    const interval = period === 'week' 
      ? { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) }
      : { start: startOfMonth(now), end: endOfMonth(now) };
    
    return transactions.filter(t => 
      isWithinInterval(parseISO(t.date), interval)
    );
  }, [transactions, period]);

  const dailyData = useMemo(() => {
    const now = new Date();
    const start = period === 'week' ? startOfWeek(now, { weekStartsOn: 1 }) : startOfMonth(now);
    const end = period === 'week' ? endOfWeek(now, { weekStartsOn: 1 }) : endOfMonth(now);
    
    const days = eachDayOfInterval({ start, end });
    
    return days.map(day => {
      const dayTransactions = currentPeriodTransactions.filter(t => isSameDay(parseISO(t.date), day));
      const income = dayTransactions
        .filter(t => t.type === TransactionType.INCOME)
        .reduce((sum, t) => sum + t.amount, 0);
      const expense = dayTransactions
        .filter(t => t.type === TransactionType.EXPENSE)
        .reduce((sum, t) => sum + t.amount, 0);
      
      return {
        name: format(day, period === 'week' ? 'EEE' : 'dd', { locale: fr }),
        income,
        expense,
        fullDate: day
      };
    });
  }, [currentPeriodTransactions, period]);

  const analytics = useMemo(() => {
    if (dailyData.length === 0) return null;
    
    const sortedExpenses = [...dailyData].sort((a, b) => b.expense - a.expense);
    const sortedIncomes = [...dailyData].sort((a, b) => b.income - a.income);
    
    // Stats par catégorie
    const categoryStats = transactions.reduce((acc, t) => {
      const key = `${t.type}-${t.category}`;
      if (!acc[key]) acc[key] = { name: t.category, type: t.type, total: 0, count: 0 };
      acc[key].total += t.amount;
      acc[key].count += 1;
      return acc;
    }, {} as Record<string, { name: string, type: TransactionType, total: number, count: number }>);

    // Stats par note (raisons fréquentes)
    const noteStats = transactions
      .filter(t => t.type === TransactionType.EXPENSE && t.description)
      .reduce((acc, t) => {
        const key = t.description!;
        if (!acc[key]) acc[key] = { text: key, total: 0, category: t.category };
        acc[key].total += t.amount;
        return acc;
      }, {} as Record<string, { text: string, total: number, category: string }>);

    return {
      topExpenseDay: sortedExpenses[0],
      minExpenseDay: [...dailyData].filter(d => d.expense > 0).sort((a, b) => a.expense - b.expense)[0],
      topIncomeDay: sortedIncomes[0],
      minIncomeDay: [...dailyData].filter(d => d.income > 0).sort((a, b) => a.income - b.income)[0],
      categoryBreakdown: Object.values(categoryStats).sort((a, b) => (b as any).total - (a as any).total),
      noteBreakdown: Object.values(noteStats).sort((a, b) => (b as any).total - (a as any).total).slice(0, 5)
    };
  }, [dailyData, transactions]);

  const budgetProgress = useMemo(() => {
    const now = new Date();
    const weekInterval = { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) };
    const monthInterval = { start: startOfMonth(now), end: endOfMonth(now) };

    return budgets.map(budget => {
      const interval = budget.period === 'weekly' ? weekInterval : monthInterval;
      
      const spent = transactions
        .filter(t => 
          t.type === TransactionType.EXPENSE && 
          t.category.toLowerCase() === budget.category.toLowerCase() &&
          isWithinInterval(parseISO(t.date), interval)
        )
        .reduce((sum, t) => sum + t.amount, 0);

      const percentage = (spent / budget.amount) * 100;
      
      return {
        ...budget,
        spent,
        percentage: Math.min(percentage, 100),
        rawPercentage: percentage,
        remaining: Math.max(budget.amount - spent, 0),
        status: percentage > 100 ? 'exceeded' : percentage > 80 ? 'warning' : 'ok'
      };
    }).sort((a, b) => b.percentage - a.percentage);
  }, [budgets, transactions]);

  // Derived Lists (Merged from transactions + saved collections)
  const finalCategories = useMemo(() => {
    const incomeMap = new Map<string, string>();
    const expenseMap = new Map<string, string>();
    
    const addNormalized = (val: string, map: Map<string, string>) => {
      const trimmed = val.trim();
      const key = trimmed.toLowerCase();
      if (!map.has(key)) map.set(key, trimmed);
    };

    // 1. From saved categories
    userCategories.income.forEach(c => addNormalized(c, incomeMap));
    userCategories.expense.forEach(c => addNormalized(c, expenseMap));
    
    // 2. From transactions
    transactions.forEach(t => {
      if (t.type === TransactionType.INCOME) addNormalized(t.category, incomeMap);
      else addNormalized(t.category, expenseMap);
    });
    
    return { 
      income: Array.from(incomeMap.values()).sort((a, b) => a.localeCompare(b)), 
      expense: Array.from(expenseMap.values()).sort((a, b) => a.localeCompare(b)) 
    };
  }, [userCategories, transactions]);

  const finalNotes = useMemo(() => {
    const notesMap = new Map<string, string>();
    
    const addNormalized = (val: string) => {
      const trimmed = val.trim();
      const key = trimmed.toLowerCase();
      if (!notesMap.has(key)) notesMap.set(key, trimmed);
    };

    userNotes.forEach(addNormalized);
    
    // Extract from transactions descriptions
    transactions.forEach(t => {
      if (t.description) {
        addNormalized(t.description);
      }
    });
    
    return Array.from(notesMap.values()).sort((a, b) => a.localeCompare(b));
  }, [userNotes, transactions]);

  const addTransaction = async (t: Omit<Transaction, 'id' | 'userId' | 'createdAt' | 'updatedAt'>) => {
    if (!user) return;
    
    // Hide modal early for smoother UX
    setIsModalOpen(false);
    
    try {
      // Check and add new category only if not in the merged list
      const currentCats = t.type === TransactionType.INCOME ? finalCategories.income : finalCategories.expense;
      if (t.category && !currentCats.some(c => c.toLowerCase() === t.category.trim().toLowerCase())) {
        await addDoc(collection(db, 'categories'), {
          userId: user.uid,
          name: t.category.trim(),
          type: t.type,
          createdAt: serverTimestamp()
        });
      }

      // Check and add new note only if not in the merged list
      if (t.description && !finalNotes.some(n => n.toLowerCase() === t.description!.trim().toLowerCase())) {
        await addDoc(collection(db, 'notes'), {
          userId: user.uid,
          text: t.description.trim(),
          createdAt: serverTimestamp()
        });
      }

      if (editingTransaction) {
        const docRef = doc(db, 'transactions', editingTransaction.id);
        await updateDoc(docRef, {
          ...t,
          updatedAt: serverTimestamp()
        });
      } else {
        await addDoc(collection(db, 'transactions'), {
          ...t,
          userId: user.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      }
      setEditingTransaction(null);
    } catch (error) {
      // Re-open if error
      setIsModalOpen(true);
      handleFirestoreError(error, editingTransaction ? OperationType.UPDATE : OperationType.CREATE, 'transactions');
    }
  };

  const addBudget = async (b: Omit<Budget, 'id' | 'userId' | 'updatedAt'>) => {
    if (!user) return;
    setIsBudgetModalOpen(false);
    
    try {
      if (editingBudget) {
        const docRef = doc(db, 'budgets', editingBudget.id);
        await updateDoc(docRef, {
          ...b,
          updatedAt: serverTimestamp()
        });
      } else {
        await addDoc(collection(db, 'budgets'), {
          ...b,
          userId: user.uid,
          updatedAt: serverTimestamp()
        });
      }
      setEditingBudget(null);
    } catch (error) {
      setIsBudgetModalOpen(true);
      handleFirestoreError(error, editingBudget ? OperationType.UPDATE : OperationType.CREATE, 'budgets');
    }
  };

  const handleEdit = (t: Transaction) => {
    setEditingTransaction(t);
    setModalType(t.type);
    setIsModalOpen(true);
  };

  const deleteTransaction = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'transactions', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `transactions/${id}`);
    }
  };

  const deleteBudget = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'budgets', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `budgets/${id}`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-brand-bg flex flex-col items-center justify-center p-6 text-center">
        <Loader2 className="animate-spin text-slate-400 mb-4" size={40} />
        <p className="text-slate-500 font-medium animate-pulse">Vérification de l'accès...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-brand-bg flex flex-col items-center justify-center p-6 text-center">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full bg-white p-10 rounded-[40px] shadow-2xl space-y-8"
        >
          <div className="mx-auto w-20 h-20 bg-slate-900 rounded-3xl flex items-center justify-center shadow-lg">
             <LayoutDashboard className="text-white" size={40} />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Épure Finance</h1>
            <p className="text-slate-400 mt-2">Gérez vos finances avec simplicité et élégance.</p>
          </div>
          <button 
            onClick={loginWithGoogle}
            className="w-full flex items-center justify-center gap-3 bg-slate-900 py-4 px-6 rounded-2xl font-semibold text-white hover:bg-slate-800 transition-all shadow-lg active:scale-95"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5 brightness-0 invert" />
            Se connecter avec Google
          </button>

          <p className="text-[10px] text-slate-300 uppercase font-bold tracking-widest">Minimaliste • Sécurisé • Rapide</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-brand-bg max-w-md mx-auto relative overflow-hidden">
      {/* Header */}
      <header className="p-6 pt-8 bg-white/50 backdrop-blur-sm sticky top-0 z-20">
        <div className="flex justify-between items-start mb-6">
          <div>
            <p className="text-slate-400 text-sm font-medium uppercase tracking-wider">Solde Actuel</p>
            <h1 className="text-4xl font-light tracking-tight mt-1">
              {balance.toLocaleString('fr-FR')} <span className="text-sm font-bold opacity-40">FCFA</span>
            </h1>
          </div>
          <div className="flex flex-col items-end gap-2">
            <button 
              onClick={logout}
              className="text-slate-400 p-2 hover:text-slate-600 transition-colors"
              title="Déconnexion"
            >
              <LogOut size={20} />
            </button>
            <div className="bg-slate-900 rounded-full p-1.5 flex gap-1 shadow-sm">
              <button 
                onClick={() => { setModalType(TransactionType.INCOME); setIsModalOpen(true); }}
                className="w-10 h-10 rounded-full bg-brand-success text-white flex items-center justify-center transition-transform active:scale-90"
                id="btn-add-income"
              >
                <Plus size={24} />
              </button>
              <button 
                onClick={() => { setModalType(TransactionType.EXPENSE); setIsModalOpen(true); }}
                className="w-10 h-10 rounded-full bg-brand-danger text-white flex items-center justify-center transition-transform active:scale-90"
                id="btn-add-expense"
              >
                <Minus size={24} />
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 bg-white rounded-2xl shadow-sm border border-slate-100 transition-all hover:border-emerald-200">
            <div className="flex items-center gap-2 text-brand-success mb-1">
              <TrendingUp size={16} />
              <span className="text-[10px] font-bold uppercase">Revenus</span>
            </div>
            <p className="text-lg font-semibold">
              {totals.income.toLocaleString('fr-FR')} <span className="text-[10px] opacity-40">FCFA</span>
            </p>
          </div>
          <div className="p-4 bg-white rounded-2xl shadow-sm border border-slate-100 transition-all hover:border-rose-200">
            <div className="flex items-center gap-2 text-brand-danger mb-1">
              <TrendingDown size={16} />
              <span className="text-[10px] font-bold uppercase">Dépenses</span>
            </div>
            <p className="text-lg font-semibold">
              {totals.expense.toLocaleString('fr-FR')} <span className="text-[10px] opacity-40">FCFA</span>
            </p>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 px-6 pb-24">
        <AnimatePresence mode="wait">
          {activeTab === 'summary' && (
            <motion.div 
              key="summary"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <section>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold text-slate-800">Activité récente</h3>
                  <button onClick={() => setActiveTab('history')} className="text-sm text-slate-400 font-medium flex items-center gap-1">
                    Tout voir <ChevronRight size={14} />
                  </button>
                </div>
                <div className="space-y-3">
                  {transactions.slice(0, 5).map(t => (
                    <TransactionItem 
                      key={t.id} 
                      transaction={t} 
                      onDelete={() => setTransactionToDelete(t.id)}
                      onEdit={() => handleEdit(t)}
                    />
                  ))}
                  {transactions.length === 0 && (
                    <div className="text-center py-12 px-4 bg-white/30 rounded-3xl border border-dashed border-slate-200">
                      <LayoutDashboard className="mx-auto text-slate-300 mb-2" size={32} />
                      <p className="text-slate-400 text-sm">Aucune transaction encore</p>
                    </div>
                  )}
                </div>
              </section>

              {budgetProgress.length > 0 && (
                <section>
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold text-slate-800">Suivi Budgets</h3>
                    <button onClick={() => setActiveTab('budgets')} className="text-sm text-slate-400 font-medium flex items-center gap-1">
                      Gérer <ChevronRight size={14} />
                    </button>
                  </div>
                  <div className="flex gap-4 overflow-x-auto pb-2 -mx-2 px-2 scrollbar-hide">
                    {budgetProgress.slice(0, 3).map(budget => (
                      <div 
                        key={budget.id} 
                        className="min-w-[200px] bg-white p-4 rounded-3xl shadow-sm border border-slate-100 shrink-0"
                      >
                        <div className="flex justify-between items-start mb-2">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest truncate max-w-[120px]">{budget.category}</p>
                          <span className={cn(
                            "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-tighter",
                            budget.status === 'exceeded' ? "bg-rose-50 text-rose-500" : budget.status === 'warning' ? "bg-amber-50 text-amber-500" : "bg-emerald-50 text-emerald-500"
                          )}>
                            {Math.round(budget.rawPercentage)}%
                          </span>
                        </div>
                        <div className="h-1.5 bg-slate-50 rounded-full overflow-hidden mb-2">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${budget.percentage}%` }}
                            className={cn(
                              "h-full rounded-full",
                              budget.status === 'exceeded' ? "bg-rose-500" : budget.status === 'warning' ? "bg-amber-500" : "bg-emerald-500"
                            )}
                          />
                        </div>
                        <p className="text-[11px] font-bold text-slate-800">
                          {budget.remaining.toLocaleString('fr-FR')} <span className="text-[9px] text-slate-400">FCFA RESTANT</span>
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold text-slate-800">Vue d'ensemble</h3>
                  <div className="flex bg-slate-100 p-1 rounded-lg">
                    <button 
                      onClick={() => setPeriod('week')}
                      className={cn("px-3 py-1 text-xs font-medium rounded-md transition-all", period === 'week' ? "bg-white shadow-sm text-slate-900" : "text-slate-500")}
                    >
                      Sem
                    </button>
                    <button 
                      onClick={() => setPeriod('month')}
                      className={cn("px-3 py-1 text-xs font-medium rounded-md transition-all", period === 'month' ? "bg-white shadow-sm text-slate-900" : "text-slate-500")}
                    >
                      Mois
                    </button>
                  </div>
                </div>
                <div className="bg-white p-4 rounded-3xl shadow-sm border border-slate-100 h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={dailyData}>
                      <defs>
                        <linearGradient id="colorIncome" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.1}/>
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="colorExpense" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#ef4444" stopOpacity={0.1}/>
                          <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                      <Tooltip 
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                        labelStyle={{ fontWeight: 'bold', marginBottom: '4px' }}
                        labelFormatter={(value) => `Date : ${value}`}
                      />
                      <Area name="Revenus" type="monotone" dataKey="income" stroke="#10b981" fillOpacity={1} fill="url(#colorIncome)" strokeWidth={2} />
                      <Area name="Dépenses" type="monotone" dataKey="expense" stroke="#ef4444" fillOpacity={1} fill="url(#colorExpense)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </section>
            </motion.div>
          )}

          {activeTab === 'history' && (
            <motion.div 
              key="history"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <h3 className="text-xl font-semibold text-slate-800">Historique complet</h3>
              <div className="space-y-4">
                {transactions.map(t => (
                  <TransactionItem 
                    key={t.id} 
                    transaction={t} 
                    onDelete={() => setTransactionToDelete(t.id)}
                    onEdit={() => handleEdit(t)}
                    showDate
                  />
                ))}
              </div>
            </motion.div>
          )}

          {activeTab === 'analytics' && (
            <motion.div 
              key="analytics"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <div className="flex justify-between items-center">
                <h3 className="text-xl font-semibold text-slate-800">Analyses {period === 'week' ? 'Hebdo' : 'Mensuelle'}</h3>
                <div className="flex bg-slate-100 p-1 rounded-lg">
                  <button onClick={() => setPeriod('week')} className={cn("px-3 py-1 text-xs transition-all rounded-md", period === 'week' ? "bg-white shadow-sm" : "text-slate-500")}>Sem</button>
                  <button onClick={() => setPeriod('month')} className={cn("px-3 py-1 text-xs transition-all rounded-md", period === 'month' ? "bg-white shadow-sm" : "text-slate-500")}>Mois</button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <AnalyticCard 
                  title="Dépense Max" 
                  item={analytics?.topExpenseDay} 
                  type={TransactionType.EXPENSE} 
                />
                <AnalyticCard 
                  title="Dépense Min" 
                  item={analytics?.minExpenseDay} 
                  type={TransactionType.EXPENSE} 
                  isMin
                />
                <AnalyticCard 
                  title="Revenu Max" 
                  item={analytics?.topIncomeDay} 
                  type={TransactionType.INCOME} 
                />
                <AnalyticCard 
                  title="Revenu Min" 
                  item={analytics?.minIncomeDay} 
                  type={TransactionType.INCOME} 
                  isMin
                />
              </div>

              {/* Pie Chart Analysis */}
              <div className="bg-white p-6 rounded-[32px] shadow-sm border border-slate-100 flex flex-col items-center">
                <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 w-full">Visualisation Dépenses</h4>
                <div className="w-full h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={analytics?.categoryBreakdown.filter(c => c.type === TransactionType.EXPENSE)}
                        cx="50%"
                        cy="50%"
                        innerRadius={65}
                        outerRadius={95}
                        paddingAngle={6}
                        dataKey="total"
                        nameKey="name"
                        stroke="none"
                        animationBegin={200}
                        animationDuration={1500}
                      >
                        {analytics?.categoryBreakdown.filter(c => c.type === TransactionType.EXPENSE).map((_, index) => (
                          <Cell 
                            key={`cell-${index}`} 
                            fill={[
                              '#0f172a', // slate-900
                              '#6366f1', // indigo-500
                              '#f59e0b', // amber-500
                              '#10b981', // emerald-500
                              '#f43f5e', // rose-500
                              '#8b5cf6', // violet-500
                              '#ec4899', // pink-500
                              '#06b6d4', // cyan-500
                            ][index % 8]} 
                          />
                        ))}
                      </Pie>
                      <Tooltip 
                        contentStyle={{ 
                          borderRadius: '20px', 
                          border: 'none', 
                          boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
                          padding: '12px 16px',
                          fontSize: '12px',
                          fontWeight: '600'
                        }}
                        itemStyle={{ color: '#0f172a' }}
                        formatter={(value: number) => [`${value.toLocaleString('fr-FR')} FCFA`, '']}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                
                {/* Visual Legend */}
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 mt-2 w-full px-2">
                  {analytics?.categoryBreakdown.filter(c => c.type === TransactionType.EXPENSE).map((cat, index) => (
                    <div key={cat.name} className="flex items-center gap-2">
                      <div 
                        className="w-2 h-2 rounded-full shrink-0" 
                        style={{ backgroundColor: [
                          '#0f172a', '#6366f1', '#f59e0b', '#10b981', '#f43f5e', '#8b5cf6', '#ec4899', '#06b6d4'
                        ][index % 8] }} 
                      />
                      <span className="text-[10px] font-bold text-slate-500 truncate">{cat.name}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Répartition par Catégorie */}
              <div className="bg-white p-6 rounded-[32px] shadow-sm border border-slate-100">
                <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-6">Répartition Dépenses</h4>
                <div className="space-y-4">
                  {analytics?.categoryBreakdown.filter(c => c.type === TransactionType.EXPENSE).map(cat => (
                    <div key={`${cat.type}-${cat.name}`} className="space-y-2">
                       <div className="flex justify-between items-end px-1">
                        <span className="text-sm font-semibold text-slate-700">{cat.name}</span>
                        <span className="text-sm font-bold text-slate-900">{cat.total.toLocaleString('fr-FR')} <span className="text-[9px] text-slate-400 font-medium">FCFA</span></span>
                      </div>
                      <div className="h-2.5 bg-slate-50 rounded-full overflow-hidden">
                        <motion.div 
                          initial={{ width: 0 }}
                          animate={{ width: `${totals.expense > 0 ? (cat.total / totals.expense) * 100 : 0}%` }}
                          className="h-full bg-slate-900 rounded-full"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Notes fréquentes */}
              <div className="bg-white p-6 rounded-[32px] shadow-sm border border-slate-100">
                <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-6">Raisons principales</h4>
                <div className="space-y-4">
                  {analytics?.noteBreakdown.map(note => (
                    <div key={note.text} className="flex items-center gap-4 p-3 bg-slate-50 rounded-2xl">
                      <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center text-slate-400 shadow-sm">
                        <History size={16} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate">{note.text}</p>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">{note.category}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-rose-500">{note.total.toLocaleString('fr-FR')}</p>
                        <p className="text-[9px] font-bold text-slate-300 uppercase tracking-widest">TOTAL</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
                <h4 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">Volume par jour</h4>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dailyData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10 }} />
                      <Tooltip 
                        cursor={{ fill: '#f8fafc' }} 
                        formatter={(value: any) => [`${value.toLocaleString('fr-FR')} FCFA`, 'Dépenses']}
                      />
                      <Bar name="Dépenses" dataKey="expense" radius={[4, 4, 0, 0]}>
                        {dailyData.map((entry, index) => (
                           <Cell key={`cell-${index}`} fill={entry.expense > entry.income ? '#fda4af' : '#e2e8f0'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-[10px] text-slate-400 mt-4 italic text-center">
                  * Les barres roses indiquent les jours où les dépenses excèdent les revenus.
                </p>
              </div>
            </motion.div>
          )}

          {activeTab === 'budgets' && (
            <motion.div 
              key="budgets"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <div className="flex justify-between items-center">
                <h3 className="text-xl font-semibold text-slate-800">Mes Budgets</h3>
                <button 
                  onClick={() => { setEditingBudget(null); setIsBudgetModalOpen(true); }}
                  className="bg-slate-900 text-white w-10 h-10 rounded-xl flex items-center justify-center shadow-lg active:scale-95"
                >
                  <Plus size={20} />
                </button>
              </div>

              <div className="space-y-4">
                {budgetProgress.map(budget => (
                  <div key={budget.id} className="bg-white p-6 rounded-[32px] shadow-sm border border-slate-100 space-y-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-bold text-slate-800 text-lg">{budget.category}</h4>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                          {budget.period === 'weekly' ? 'Hebdomadaire' : 'Mensuel'} • {budget.amount.toLocaleString('fr-FR')} FCFA
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => { setEditingBudget(budget); setIsBudgetModalOpen(true); }}
                          className="p-2 text-slate-300 hover:text-slate-600 transition-colors"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button 
                          onClick={() => setBudgetToDelete(budget.id)}
                          className="p-2 text-slate-300 hover:text-rose-500 transition-colors"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex justify-between items-end text-xs font-bold px-1">
                        <span className={cn(
                          budget.status === 'exceeded' ? "text-rose-500" : budget.status === 'warning' ? "text-amber-500" : "text-emerald-500"
                        )}>
                          {budget.spent.toLocaleString('fr-FR')} FCFA
                        </span>
                        <span className="text-slate-400">
                          {Math.round(budget.rawPercentage)}%
                        </span>
                      </div>
                      <div className="h-3 bg-slate-50 rounded-full overflow-hidden">
                        <motion.div 
                          initial={{ width: 0 }}
                          animate={{ width: `${budget.percentage}%` }}
                          className={cn(
                            "h-full rounded-full transition-colors",
                            budget.status === 'exceeded' ? "bg-rose-500" : budget.status === 'warning' ? "bg-amber-500" : "bg-emerald-500"
                          )}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] font-medium text-slate-400 px-1">
                        <span>Dépensé</span>
                        <span>{budget.status === 'exceeded' ? 'Dépassé' : `Reste ${budget.remaining.toLocaleString('fr-FR')} FCFA`}</span>
                      </div>
                    </div>
                  </div>
                ))}

                {budgets.length === 0 && (
                  <div className="text-center py-16 px-4 bg-white/30 rounded-[40px] border border-dashed border-slate-200">
                    <Target className="mx-auto text-slate-200 mb-4" size={48} />
                    <h4 className="text-slate-700 font-bold mb-1">Aucun budget défini</h4>
                    <p className="text-slate-400 text-sm max-w-[200px] mx-auto">Définissez des limites par catégorie pour mieux contrôler vos dépenses.</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Navigation Bar */}
      <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto p-4 bg-white/80 backdrop-blur-lg border-t border-slate-100 flex justify-between z-10 px-6">
        <NavButton active={activeTab === 'summary'} onClick={() => setActiveTab('summary')} icon={<LayoutDashboard size={20} />} label="Stats" />
        <NavButton active={activeTab === 'history'} onClick={() => setActiveTab('history')} icon={<History size={20} />} label="Journal" />
        <NavButton active={activeTab === 'analytics'} onClick={() => setActiveTab('analytics')} icon={<ChartIcon size={20} />} label="Analyse" />
        <NavButton active={activeTab === 'budgets'} onClick={() => setActiveTab('budgets')} icon={<Target size={20} />} label="Budgets" />
      </nav>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {(transactionToDelete || budgetToDelete) && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => { setTransactionToDelete(null); setBudgetToDelete(null); }}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative bg-white rounded-[32px] p-8 shadow-2xl w-full max-w-xs text-center"
            >
              <div className="w-16 h-16 bg-rose-50 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-4">
                <Trash2 size={32} />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">Supprimer ?</h3>
              <p className="text-slate-500 text-sm mb-8">Cette action est irréversible. Voulez-vous vraiment continuer ?</p>
              <div className="flex gap-3">
                <button 
                  onClick={() => { setTransactionToDelete(null); setBudgetToDelete(null); }}
                  className="flex-1 py-3 px-4 bg-slate-100 text-slate-600 rounded-xl font-bold text-sm transition-all active:scale-95"
                >
                  Annuler
                </button>
                <button 
                  onClick={() => {
                    if (transactionToDelete) {
                      deleteTransaction(transactionToDelete);
                      setTransactionToDelete(null);
                    }
                    if (budgetToDelete) {
                      deleteBudget(budgetToDelete);
                      setBudgetToDelete(null);
                    }
                  }}
                  className="flex-1 py-3 px-4 bg-rose-500 text-white rounded-xl font-bold text-sm shadow-lg shadow-rose-200 transition-all active:scale-95"
                >
                  Supprimer
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Budget Modal */}
      <AnimatePresence>
        {isBudgetModalOpen && (
          <div className="fixed inset-0 z-50 flex items-end justify-center p-0">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsBudgetModalOpen(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="relative w-full max-w-md bg-white rounded-t-[32px] p-8 shadow-2xl overflow-hidden"
            >
               <div className="w-12 h-1.5 bg-slate-100 rounded-full mx-auto mb-6" />
               <header className="flex justify-between items-center mb-8">
                 <div>
                   <h2 className="text-2xl font-semibold">
                     {editingBudget ? 'Modifier le budget' : 'Définir un budget'}
                   </h2>
                   <p className="text-slate-400 text-sm">Contrôlez vos dépenses par catégorie</p>
                 </div>
                 <button 
                  onClick={() => { setIsBudgetModalOpen(false); setEditingBudget(null); }} 
                  className="bg-slate-50 p-2 rounded-full text-slate-400"
                >
                   <X size={20} />
                 </button>
               </header>
               
               <BudgetForm 
                onSubmit={addBudget} 
                initialData={editingBudget}
                availableCategories={finalCategories.expense}
               />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-end justify-center p-0">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="relative w-full max-w-md bg-white rounded-t-[32px] p-8 shadow-2xl overflow-hidden"
            >
               <div className="w-12 h-1.5 bg-slate-100 rounded-full mx-auto mb-6" />
               <header className="flex justify-between items-center mb-8">
                 <div>
                   <h2 className="text-2xl font-semibold">
                     {editingTransaction ? 'Modifier' : 'Ajouter'} {modalType === TransactionType.INCOME ? 'un revenu' : 'une dépense'}
                   </h2>
                   <p className="text-slate-400 text-sm">Saisissez les détails ci-dessous</p>
                 </div>
                 <button 
                  onClick={() => { setIsModalOpen(false); setEditingTransaction(null); }} 
                  className="bg-slate-50 p-2 rounded-full text-slate-400"
                >
                   <X size={20} />
                 </button>
               </header>
               
               <TransactionForm 
                type={modalType} 
                onSubmit={addTransaction} 
                initialData={editingTransaction}
                availableCategories={modalType === TransactionType.INCOME ? finalCategories.income : finalCategories.expense}
                availableNotes={finalNotes}
               />
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SuggestionInput({ 
  label, 
  value, 
  onChange, 
  suggestions, 
  placeholder, 
  autoFocus = false 
}: { 
  label: string, 
  value: string, 
  onChange: (val: string) => void, 
  suggestions: string[], 
  placeholder?: string,
  autoFocus?: boolean
}) {
  const [isOpen, setIsOpen] = useState(false);
  const filteredSuggestions = suggestions.filter(s => 
    s.toLowerCase().includes(value.toLowerCase()) && s !== value
  );
  const showCreate = value.trim() !== '' && !suggestions.some(s => s.toLowerCase() === value.trim().toLowerCase());

  return (
    <div className="relative">
      <label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest block mb-2 px-1">{label}</label>
      <input 
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setIsOpen(true);
        }}
        onBlur={() => {
          // Small delay to allow clicking a suggestion
          setTimeout(() => setIsOpen(false), 200);
        }}
        onFocus={() => setIsOpen(true)}
        className="w-full bg-slate-50 border-none rounded-xl py-3 px-4 text-sm font-medium focus:ring-1 focus:ring-slate-900 transition-all font-sans"
        placeholder={placeholder}
        autoFocus={autoFocus}
      />
      
      <AnimatePresence>
        {isOpen && (filteredSuggestions.length > 0 || showCreate) && (
          <motion.ul 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute z-30 w-full mt-2 bg-white rounded-2xl shadow-xl border border-slate-100 max-h-48 overflow-y-auto overflow-x-hidden py-2"
          >
            {showCreate && (
              <li>
                <button
                  type="button"
                  onClick={() => {
                    onChange(value.trim());
                    setIsOpen(false);
                  }}
                  className="w-full text-left px-4 py-3 text-sm hover:bg-slate-50 flex items-center gap-3 transition-colors border-b border-slate-50"
                >
                  <div className="w-6 h-6 rounded-lg bg-slate-900 flex items-center justify-center text-white">
                    <Plus size={14} />
                  </div>
                  <div>
                    <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-tight">Nouvelle entrée</span>
                    <span className="font-bold text-slate-900">{value}</span>
                  </div>
                </button>
              </li>
            )}

            {filteredSuggestions.map((suggestion) => (
              <li key={suggestion}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(suggestion);
                    setIsOpen(false);
                  }}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 flex items-center gap-2 transition-colors"
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                  <span className="font-medium text-slate-700">{suggestion}</span>
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

function TransactionForm({ type, onSubmit, initialData, availableCategories, availableNotes }: { 
  type: TransactionType, 
  onSubmit: (t: Omit<Transaction, 'id' | 'userId' | 'createdAt' | 'updatedAt'>) => void,
  initialData?: Transaction | null,
  availableCategories: string[],
  availableNotes: string[]
}) {
  const [amount, setAmount] = useState(initialData ? initialData.amount.toString() : '');
  const [category, setCategory] = useState(initialData ? initialData.category : '');
  const [date, setDate] = useState(initialData ? format(parseISO(initialData.date), 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'));
  const [description, setDescription] = useState(initialData?.description || '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount) return;
    
    onSubmit({
      amount: parseFloat(amount),
      type,
      category: category.trim() || 'Autre',
      date: new Date(date).toISOString(),
      description: description.trim() || undefined
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="relative">
        <span className="absolute left-6 top-1/2 -translate-y-1/2 text-lg font-bold text-slate-300">FCFA</span>
        <input 
          type="number" 
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0"
          className="w-full bg-slate-50 border-none rounded-2xl py-6 pl-20 pr-6 text-3xl font-light focus:ring-2 focus:ring-slate-900 transition-all placeholder:text-slate-200"
          autoFocus={!initialData}
        />
      </div>

      <div className="space-y-4">
        <SuggestionInput 
          label="Catégorie"
          value={category}
          onChange={setCategory}
          suggestions={availableCategories}
          placeholder="Saisir ou choisir une catégorie..."
        />

        <div>
          <label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest block mb-2 px-1">Date</label>
          <input 
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full bg-slate-50 border-none rounded-xl py-3 px-4 text-sm font-medium focus:ring-1 focus:ring-slate-900"
          />
        </div>

        <SuggestionInput 
          label="Note (optionnel)"
          value={description}
          onChange={setDescription}
          suggestions={availableNotes}
          placeholder="Détails (ex: Carrefour, Loyer...)"
        />
      </div>

      <button 
        type="submit" 
        className={cn(
          "w-full py-4 rounded-2xl text-white font-semibold text-lg shadow-lg active:scale-[0.98] transition-all",
          type === TransactionType.INCOME ? "bg-brand-success shadow-emerald-200" : "bg-brand-danger shadow-rose-200"
        )}
      >
        Confirmer
      </button>
    </form>
  );
}

function BudgetForm({ onSubmit, initialData, availableCategories }: { 
  onSubmit: (b: Omit<Budget, 'id' | 'userId' | 'updatedAt'>) => void,
  initialData?: Budget | null,
  availableCategories: string[]
}) {
  const [amount, setAmount] = useState(initialData ? initialData.amount.toString() : '');
  const [category, setCategory] = useState(initialData ? initialData.category : '');
  const [period, setPeriod] = useState<'weekly' | 'monthly'>(initialData ? initialData.period : 'monthly');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || !category) return;
    
    onSubmit({
      amount: parseFloat(amount),
      category: category.trim(),
      period
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="relative">
        <span className="absolute left-6 top-1/2 -translate-y-1/2 text-lg font-bold text-slate-300">FCFA</span>
        <input 
          type="number" 
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Montant du budget"
          className="w-full bg-slate-50 border-none rounded-2xl py-6 pl-20 pr-6 text-3xl font-light focus:ring-2 focus:ring-slate-900 transition-all placeholder:text-slate-200"
          autoFocus={!initialData}
        />
      </div>

      <div className="space-y-4">
        <SuggestionInput 
          label="Catégorie"
          value={category}
          onChange={setCategory}
          suggestions={availableCategories}
          placeholder="Sélectionner une catégorie..."
        />

        <div>
          <label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest block mb-2 px-1">Période</label>
          <div className="grid grid-cols-2 gap-2">
            <button 
              type="button"
              onClick={() => setPeriod('weekly')}
              className={cn(
                "py-3 rounded-xl text-sm font-bold transition-all border",
                period === 'weekly' ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-400 border-slate-100 hover:bg-slate-50"
              )}
            >
              Hebdomadaire
            </button>
            <button 
              type="button"
              onClick={() => setPeriod('monthly')}
              className={cn(
                "py-3 rounded-xl text-sm font-bold transition-all border",
                period === 'monthly' ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-400 border-slate-100 hover:bg-slate-50"
              )}
            >
              Mensuel
            </button>
          </div>
        </div>
      </div>

      <button 
        type="submit" 
        className="w-full py-4 rounded-2xl bg-slate-900 text-white font-semibold text-lg shadow-lg active:scale-[0.98] transition-all mt-4"
      >
        Enregistrer le budget
      </button>
    </form>
  );
}

interface TransactionItemProps {
  transaction: Transaction;
  showDate?: boolean;
  onDelete?: () => void | Promise<void>;
  onEdit?: () => void;
  key?: React.Key;
}

function TransactionItem({ transaction, showDate, onDelete, onEdit }: TransactionItemProps) {
  const isIncome = transaction.type === TransactionType.INCOME;
  const [isExpanded, setIsExpanded] = useState(false);
  
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-4 p-4 transition-all active:scale-[0.99] cursor-pointer select-none"
      >
        <div className={cn(
          "w-11 h-11 rounded-2xl flex items-center justify-center transition-colors shadow-sm",
          isIncome ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"
        )}>
          {isIncome ? <IconIncome size={22} /> : <IconExpense size={22} />}
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-slate-800 text-sm truncate">{transaction.category}</h4>
          <div className="flex flex-col gap-0.5">
            {transaction.description && (
              <p className="text-[11px] text-slate-500 font-medium truncate">{transaction.description}</p>
            )}
            {showDate && (
              <span className="text-[10px] text-slate-400 font-medium uppercase tracking-tight">
                {format(parseISO(transaction.date), 'dd MMM yyyy', { locale: fr })}
              </span>
            )}
          </div>
        </div>
        <div className="text-right">
          <p className={cn(
            "font-bold text-sm tracking-tight",
            isIncome ? "text-brand-success" : "text-brand-danger"
          )}>
            {isIncome ? '+' : '-'} {transaction.amount.toLocaleString('fr-FR', { minimumFractionDigits: 0 })}
          </p>
          <motion.div
            animate={{ rotate: isExpanded ? 180 : 0 }}
            className="inline-block"
          >
            <ChevronRight size={12} className="text-slate-300 transform rotate-90" />
          </motion.div>
        </div>
      </div>
      
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-slate-50 flex bg-slate-50/50"
          >
            <button 
              onClick={(e) => { e.stopPropagation(); onEdit?.(); setIsExpanded(false); }}
              className="flex-1 flex items-center justify-center gap-2 py-4 text-slate-600 hover:bg-slate-100 transition-colors font-bold text-[10px] uppercase tracking-widest"
            >
              <Edit2 size={14} className="text-slate-400" />
              Modifier
            </button>
            <div className="w-[1px] bg-slate-100" />
            <button 
              onClick={(e) => { e.stopPropagation(); onDelete?.(); setIsExpanded(false); }}
              className="flex-1 flex items-center justify-center gap-2 py-4 text-rose-500 hover:bg-rose-100 transition-colors font-bold text-[10px] uppercase tracking-widest"
            >
              <Trash2 size={14} className="text-rose-400" />
              Supprimer
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AnalyticCard({ title, item, type, isMin }: { title: string, item: any, type: TransactionType, isMin?: boolean }) {
  const isIncome = type === TransactionType.INCOME;
  const amount = isIncome ? item?.income : item?.expense;
  
  return (
    <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{title}</p>
      <div className="flex flex-col">
        <span className={cn(
          "text-xl font-bold",
          isIncome ? "text-brand-success" : "text-brand-danger"
        )}>
          {amount ? `${amount.toLocaleString('fr-FR')} FCFA` : '0 FCFA'}
        </span>
        <span className="text-[10px] text-slate-400 font-medium">
          {item?.name || '---'}
        </span>
      </div>
    </div>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1 transition-all active:scale-95">
      <div className={cn(
        "w-10 h-10 rounded-xl flex items-center justify-center transition-all",
        active ? "bg-slate-900 text-white shadow-md shadow-slate-200" : "text-slate-400 bg-transparent"
      )}>
        {icon}
      </div>
      <span className={cn(
        "text-[10px] font-bold uppercase tracking-widest",
        active ? "text-slate-900" : "text-slate-400"
      )}>{label}</span>
    </button>
  );
}
