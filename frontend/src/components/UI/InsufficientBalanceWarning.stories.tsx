import type { Meta, StoryObj } from '@storybook/react'
import { fn } from 'storybook/test'
import { InsufficientBalanceWarning } from './InsufficientBalanceWarning'
import { WalletContext } from '../../context/WalletContext'
import { ToastContext } from '../../context/ToastContext'

const mockWalletValue = {
  wallet: { address: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567', isConnected: true, balance: '5.0000000' },
  isConnecting: false,
  error: null,
  isInstalled: true,
  connect: fn(),
  disconnect: fn(),
  refreshBalance: fn(),
}

const mockToastValue = {
  toasts: [],
  addToast: fn(),
  removeToast: fn(),
}

const meta: Meta<typeof InsufficientBalanceWarning> = {
  title: 'UI/InsufficientBalanceWarning',
  component: InsufficientBalanceWarning,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <WalletContext.Provider value={mockWalletValue}>
        <ToastContext.Provider value={mockToastValue}>
          <Story />
        </ToastContext.Provider>
      </WalletContext.Provider>
    ),
  ],
  args: {
    shortfall: '0.5000000',
    isTestnet: true,
  },
}
export default meta

type Story = StoryObj<typeof InsufficientBalanceWarning>

export const Default: Story = {}

export const Mainnet: Story = { args: { isTestnet: false } }

export const LargeShortfall: Story = { args: { shortfall: '125.0000000' } }
