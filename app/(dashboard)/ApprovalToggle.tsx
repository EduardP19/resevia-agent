'use client';

import { useApproval } from './ApprovalContext';

interface ApprovalToggleProps {
  /** Show label + description row (Settings page). Defaults to pill-only (header). */
  withDescription?: boolean;
}

export default function ApprovalToggle({ withDescription }: ApprovalToggleProps) {
  const { mode, saving, toggle, agentName } = useApproval();

  const isLoading = mode === null;

  const pill = (
    <button
      onClick={toggle}
      disabled={saving || isLoading}
      className="flex items-center gap-2.5 px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-widest transition-all duration-200 disabled:opacity-60 w-[160px] justify-center"
      style={isLoading
        ? { background: 'rgba(109,40,217,0.06)', border: '1px solid rgba(109,40,217,0.1)', color: 'transparent' }
        : mode
        ? { background: 'rgba(109,40,217,0.1)', color: '#6D28D9', border: '1px solid rgba(109,40,217,0.25)' }
        : { background: 'rgba(52,211,153,0.1)', color: '#059669', border: '1px solid rgba(52,211,153,0.3)' }
      }
      title={mode ? `Manual Approval — ${agentName} drafts, you approve before sending` : `Automatic Reply — ${agentName} sends directly to clients`}
    >
      <span
        className="relative inline-flex w-7 h-4 rounded-full flex-shrink-0 transition-all duration-200"
        style={{ background: isLoading ? '#e5e7eb' : mode ? '#6D28D9' : '#10B981' }}
      >
        <span
          className="absolute top-0.5 w-3 h-3 bg-white rounded-full shadow-sm transition-all duration-200"
          style={{ left: (!isLoading && mode) ? '14px' : '2px' }}
        />
      </span>
      {!isLoading && (mode ? 'Manual Approval' : 'Automatic Reply')}
    </button>
  );

  if (!withDescription) return pill;

  return (
    <div
      className="flex items-center justify-between p-4 rounded-2xl transition-all duration-200"
      style={{
        background: mode ? 'rgba(109,40,217,0.06)' : '#faf8fd',
        border: `1px solid ${mode ? 'rgba(109,40,217,0.2)' : 'rgba(109,40,217,0.08)'}`,
      }}
    >
      <div>
        <p className="text-sm font-bold text-gray-800">
          {mode ? 'Manual Approval' : 'Automatic Reply'}
        </p>
        <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
          {mode
            ? `${agentName} drafts — you approve before sending`
            : `${agentName} sends directly to clients`}
        </p>
      </div>
      {pill}
    </div>
  );
}
