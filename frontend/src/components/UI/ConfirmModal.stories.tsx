import type { Meta, StoryObj } from '@storybook/react'
import { fn } from 'storybook/test'
import { ConfirmModal } from './ConfirmModal'

const meta: Meta<typeof ConfirmModal> = {
  title: 'UI/ConfirmModal',
  component: ConfirmModal,
  tags: ['autodocs'],
  args: {
    isOpen: true,
    title: 'Confirm Transaction',
    details: [
      { label: 'Amount', value: '100 XLM' },
      { label: 'Recipient', value: 'GABCD…WXYZ' },
      { label: 'Network Fee', value: '0.00001 XLM' },
    ],
    onConfirm: fn(),
    onCancel: fn(),
  },
  parameters: { layout: 'fullscreen' },
}
export default meta

type Story = StoryObj<typeof ConfirmModal>

export const Default: Story = {
  args: {
    description: 'Please review the details before confirming.',
  },
}

export const WithoutDescription: Story = {}

export const DestructiveAction: Story = {
  args: {
    title: 'Delete Token',
    description: 'This action cannot be undone.',
    confirmLabel: 'Delete',
    details: [{ label: 'Token', value: 'MTK — My Token' }],
  },
}

export const Closed: Story = { args: { isOpen: false } }
