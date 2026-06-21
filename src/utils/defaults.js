export function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const DEFAULT_EXPENSE_CATEGORIES = [
  { id: 'ec1', name: 'Rent / Housing', category: 'housing', color: '#6366f1' },
  { id: 'ec2', name: 'Food & Groceries', category: 'food', color: '#10b981' },
  { id: 'ec3', name: 'Transport / Car', category: 'transport', color: '#06b6d4' },
  { id: 'ec4', name: 'Utilities', category: 'utilities', color: '#f59e0b' },
  { id: 'ec5', name: 'Insurance', category: 'insurance', color: '#8b5cf6' },
  { id: 'ec6', name: 'Entertainment', category: 'entertainment', color: '#ec4899' },
  { id: 'ec7', name: 'Healthcare', category: 'health', color: '#14b8a6' },
  { id: 'ec8', name: 'Shopping & Other', category: 'other', color: '#64748b' },
];

const FRESH_RETIREMENT_PLAN = {
  name: 'My Plan',
  currentAge: 30,
  retirementAge: 60,
  lifeExpectancy: 90,
  monthlyExpenseToday: 0,
  inflationRate: 6,
  currentCorpus: 0,
  expectedReturn: 10,
  conservativeReturn: 7,
  moderateReturn: 9,
  aggressiveReturn: 12,
  assetAllocation: { equity: 70, debt: 20, gold: 5, cash: 5 },
  volatility: 15,
  monthlySIP: 0,
  annualSIPIncrease: 10,
};

const FRESH_FREEDOM_SETTINGS = {
  withdrawalAmount: 0,
  withdrawalFrequency: 'monthly',
  durationYears: 30,
  inflationRate: 6,
  inflationAdjusted: true,
  expectedReturn: 10,
  safeWithdrawalRate: 3.5,
};

export function createDefaultPlan() {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    ...FRESH_RETIREMENT_PLAN,
    createdAt: now,
    updatedAt: now,
  };
}

/** Empty household data for a brand-new signup — no sample assets, loans, or history. */
export function createFreshAppData(userName) {
  const plan = createDefaultPlan();
  const displayName = (userName || 'You').trim() || 'You';

  return {
    personalFinance: {
      familyMembers: [{
        id: generateId(),
        name: displayName,
        relationship: 'Self',
        monthlyIncome: 0,
        monthlyExpense: 0,
      }],
      assets: [],
      loans: [],
      financialGoals: [],
      smallGoals: [],
      monthlyFixedExpenses: 0,
      monthlyVariableExpenses: 0,
      otherIncome: 0,
      expenseCategories: DEFAULT_EXPENSE_CATEGORIES,
      monthlyRecords: [],
      freedomSettings: { ...FRESH_FREEDOM_SETTINGS },
      updatedAt: new Date().toISOString(),
    },
    retirementPlans: [plan],
    activePlanId: plan.id,
    theme: 'dark',
  };
}

/** @deprecated Use createFreshAppData */
export function createDefaultAppData(userName) {
  return createFreshAppData(userName);
}
