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
  Loader2
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
  Cell
} from 'recharts';
import { Transaction, TransactionType, CATEGORIES } from './types.ts';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { auth, db, loginWithGoogle, logout } from './lib/firebase.ts';
import { onAuthStateChanged, User } from 'firebase/auth';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  deleteDoc, 
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
  const [activeTab, setActiveTab] = useState<'summary' | 'history' | 'analytics'>('summary');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState<TransactionType>(TransactionType.EXPENSE);
  const [period, setPeriod] = useState<'week' | 'month'>('month');

  // Auth Listener
  useEffect(() => {
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
    
    return {
      topExpenseDay: sortedExpenses[0],
      minExpenseDay: [...dailyData].filter(d => d.expense > 0).sort((a, b) => a.expense - b.expense)[0],
      topIncomeDay: sortedIncomes[0],
      minIncomeDay: [...dailyData].filter(d => d.income > 0).sort((a, b) => a.income - b.income)[0],
    };
  }, [dailyData]);

  const addTransaction = async (t: Omit<Transaction, 'id' | 'userId' | 'createdAt' | 'updatedAt'>) => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'transactions'), {
        ...t,
        userId: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      setIsModalOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'transactions');
    }
  };

  const deleteTransaction = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'transactions', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `transactions/${id}`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center">
        <Loader2 className="animate-spin text-slate-400" size={40} />
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
            className="w-full flex items-center justify-center gap-3 bg-white border border-slate-200 py-4 px-6 rounded-2xl font-semibold text-slate-700 hover:bg-slate-50 transition-all shadow-sm active:scale-95"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5" />
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
              {balance.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
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
              {totals.income.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
            </p>
          </div>
          <div className="p-4 bg-white rounded-2xl shadow-sm border border-slate-100 transition-all hover:border-rose-200">
            <div className="flex items-center gap-2 text-brand-danger mb-1">
              <TrendingDown size={16} />
              <span className="text-[10px] font-bold uppercase">Dépenses</span>
            </div>
            <p className="text-lg font-semibold">
              {totals.expense.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
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
                    <TransactionItem key={t.id} transaction={t} />
                  ))}
                  {transactions.length === 0 && (
                    <div className="text-center py-12 px-4 bg-white/30 rounded-3xl border border-dashed border-slate-200">
                      <LayoutDashboard className="mx-auto text-slate-300 mb-2" size={32} />
                      <p className="text-slate-400 text-sm">Aucune transaction encore</p>
                    </div>
                  )}
                </div>
              </section>

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
                      />
                      <Area type="monotone" dataKey="income" stroke="#10b981" fillOpacity={1} fill="url(#colorIncome)" strokeWidth={2} />
                      <Area type="monotone" dataKey="expense" stroke="#ef4444" fillOpacity={1} fill="url(#colorExpense)" strokeWidth={2} />
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
                    onDelete={() => deleteTransaction(t.id)}
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

              <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
                <h4 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">Volume par jour</h4>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dailyData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10 }} />
                      <Tooltip cursor={{ fill: '#f8fafc' }} />
                      <Bar dataKey="expense" radius={[4, 4, 0, 0]}>
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
        </AnimatePresence>
      </main>

      {/* Navigation Bar */}
      <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto p-4 bg-white/80 backdrop-blur-lg border-t border-slate-100 flex justify-between z-10 px-8">
        <NavButton active={activeTab === 'summary'} onClick={() => setActiveTab('summary')} icon={<LayoutDashboard size={20} />} label="Stats" />
        <NavButton active={activeTab === 'history'} onClick={() => setActiveTab('history')} icon={<History size={20} />} label="Journal" />
        <NavButton active={activeTab === 'analytics'} onClick={() => setActiveTab('analytics')} icon={<ChartIcon size={20} />} label="Analyse" />
      </nav>

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
                   <h2 className="text-2xl font-semibold">Ajouter {modalType === TransactionType.INCOME ? 'un revenu' : 'une dépense'}</h2>
                   <p className="text-slate-400 text-sm">Saisissez les détails ci-dessous</p>
                 </div>
                 <button onClick={() => setIsModalOpen(false)} className="bg-slate-50 p-2 rounded-full text-slate-400">
                   <X size={20} />
                 </button>
               </header>
               
               <TransactionForm 
                type={modalType} 
                onSubmit={addTransaction} 
               />
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TransactionForm({ type, onSubmit }: { type: TransactionType, onSubmit: (t: Omit<Transaction, 'id' | 'userId' | 'createdAt' | 'updatedAt'>) => void }) {
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState(CATEGORIES[type][0]);
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [description, setDescription] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount) return;
    onSubmit({
      amount: parseFloat(amount),
      type,
      category,
      date: new Date(date).toISOString(),
      description
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="relative">
        <span className="absolute left-6 top-1/2 -translate-y-1/2 text-2xl font-light text-slate-300">€</span>
        <input 
          type="number" 
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className="w-full bg-slate-50 border-none rounded-2xl py-6 pl-12 pr-6 text-3xl font-light focus:ring-2 focus:ring-slate-900 transition-all placeholder:text-slate-200"
          autoFocus
          step="0.01"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest block mb-2 px-1">Catégorie</label>
          <select 
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full bg-slate-50 border-none rounded-xl py-3 px-4 text-sm font-medium focus:ring-1 focus:ring-slate-900"
          >
            {CATEGORIES[type].map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest block mb-2 px-1">Date</label>
          <input 
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full bg-slate-50 border-none rounded-xl py-3 px-4 text-sm font-medium focus:ring-1 focus:ring-slate-900"
          />
        </div>
      </div>

      <div>
        <label className="text-[10px] font-bold uppercase text-slate-400 tracking-widest block mb-2 px-1">Note (optionnel)</label>
        <input 
          type="text" 
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="ex: Courses hebdomadaires"
          className="w-full bg-slate-50 border-none rounded-xl py-3 px-4 text-sm focus:ring-1 focus:ring-slate-900"
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

interface TransactionItemProps {
  transaction: Transaction;
  showDate?: boolean;
  onDelete?: () => void | Promise<void>;
  key?: React.Key;
}

function TransactionItem({ transaction, showDate, onDelete }: TransactionItemProps) {
  const isIncome = transaction.type === TransactionType.INCOME;
  
  return (
    <motion.div 
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-4 bg-white p-4 rounded-2xl shadow-sm border border-slate-100 group hover:border-slate-300 transition-all active:scale-[0.99]"
    >
      <div className={cn(
        "w-11 h-11 rounded-2xl flex items-center justify-center transition-colors shadow-sm",
        isIncome ? "bg-emerald-50 text-emerald-600 group-hover:bg-emerald-100" : "bg-rose-50 text-rose-600 group-hover:bg-rose-100"
      )}>
        {isIncome ? <IconIncome size={22} /> : <IconExpense size={22} />}
      </div>
      <div className="flex-1 min-w-0">
        <h4 className="font-semibold text-slate-800 text-sm truncate">{transaction.description || transaction.category}</h4>
        <div className="flex items-center gap-2">
          {!transaction.description && <span className="text-[9px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded uppercase font-extrabold tracking-tighter">{transaction.category}</span>}
          {showDate && <span className="text-[10px] text-slate-400 font-medium">{format(parseISO(transaction.date), 'dd MMM yyyy', { locale: fr })}</span>}
        </div>
      </div>
      <div className="text-right">
        <p className={cn(
          "font-bold text-sm tracking-tight",
          isIncome ? "text-brand-success" : "text-brand-danger"
        )}>
          {isIncome ? '+' : '-'} {transaction.amount.toLocaleString('fr-FR', { minimumFractionDigits: 2 })}
        </p>
        <AnimatePresence>
          {onDelete && (
            <motion.button 
              initial={{ opacity: 0 }}
              whileHover={{ opacity: 1 }}
              onClick={onDelete} 
              className="text-[9px] text-rose-400 hover:text-rose-600 transition-colors uppercase font-bold underline cursor-pointer mt-0.5"
            >
              Supprimer
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
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
          {amount ? amount.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }) : '0 €'}
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
