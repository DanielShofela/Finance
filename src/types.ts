/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export enum TransactionType {
  EXPENSE = 'expense',
  INCOME = 'income',
}

export interface Transaction {
  id: string;
  userId: string;
  amount: number;
  type: TransactionType;
  category: string;
  date: string; // ISO string
  description?: string;
  createdAt: any; // Firestore serverTimestamp
  updatedAt: any; // Firestore serverTimestamp
}

export const CATEGORIES = {
  [TransactionType.EXPENSE]: [],
  [TransactionType.INCOME]: []
};

export interface DailyStat {
  date: string;
  amount: number;
}
