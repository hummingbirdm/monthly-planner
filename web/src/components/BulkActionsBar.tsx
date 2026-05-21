import { useState } from "react";
import type { V3User } from "../lib/teamwork";

export default function BulkActionsBar({
  visibleCount, filterActive, users,
  onReassign, onAddAssignee, onShiftDays, onClearZero, onDeselectAll, onSelectAll,
}: {
  visibleCount: number;
  filterActive: boolean;
  users: V3User[];
  onReassign: (uid: number) => void;
  onAddAssignee: (uid: number) => void;
  onShiftDays: (days: number) => void;
  onClearZero: () => void;
  onDeselectAll: () => void;
  onSelectAll: () => void;
}) {
  const [reassignOpen, setReassignOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [shiftDays, setShiftDays] = useState("0");

  if (!filterActive) return null;

  const sortedUsers = [...users].sort((a, b) => (a.firstName || "").localeCompare(b.firstName || ""));

  return (
    <div className="max-w-7xl mx-auto px-6 mt-3">
      <div className="bg-blue-50 border border-blue-200 rounded-md px-3 py-2 flex items-center gap-3 flex-wrap text-xs">
        <span className="font-medium text-blue-900">
          {visibleCount} visible {visibleCount === 1 ? "task" : "tasks"} — bulk actions:
        </span>

        <div className="relative">
          <button
            onClick={() => { setReassignOpen((o) => !o); setAddOpen(false); }}
            className="px-2 py-1 border border-blue-300 rounded bg-white hover:bg-blue-50"
          >
            Reassign to…
          </button>
          {reassignOpen && (
            <UserPickerMenu
              users={sortedUsers}
              onPick={(uid) => { onReassign(uid); setReassignOpen(false); }}
              onClose={() => setReassignOpen(false)}
            />
          )}
        </div>

        <div className="relative">
          <button
            onClick={() => { setAddOpen((o) => !o); setReassignOpen(false); }}
            className="px-2 py-1 border border-blue-300 rounded bg-white hover:bg-blue-50"
          >
            Add assignee…
          </button>
          {addOpen && (
            <UserPickerMenu
              users={sortedUsers}
              onPick={(uid) => { onAddAssignee(uid); setAddOpen(false); }}
              onClose={() => setAddOpen(false)}
            />
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-blue-900">Shift dates by</span>
          <input
            type="number"
            value={shiftDays}
            onChange={(e) => setShiftDays(e.target.value)}
            className="w-16 px-1.5 py-1 border border-blue-300 rounded bg-white"
          />
          <span className="text-blue-900">days</span>
          <button
            onClick={() => {
              const n = Number(shiftDays);
              if (!isNaN(n)) onShiftDays(n);
            }}
            className="px-2 py-1 border border-blue-300 rounded bg-white hover:bg-blue-50"
          >
            Apply
          </button>
        </div>

        <button
          onClick={onClearZero}
          className="px-2 py-1 border border-blue-300 rounded bg-white hover:bg-blue-50"
        >
          Remove 0-min tasks
        </button>

        <button
          onClick={onSelectAll}
          className="px-2 py-1 border border-blue-300 rounded bg-white hover:bg-blue-50"
        >
          Select all
        </button>

        <button
          onClick={onDeselectAll}
          className="px-2 py-1 border border-blue-300 rounded bg-white hover:bg-blue-50"
        >
          Deselect all
        </button>
      </div>
    </div>
  );
}

function UserPickerMenu({
  users, onPick, onClose,
}: {
  users: V3User[];
  onPick: (uid: number) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className="absolute z-40 mt-1 w-56 bg-white border border-zinc-200 rounded-md shadow-lg max-h-72 overflow-y-auto">
        {users.length === 0 && (
          <div className="px-3 py-2 text-xs text-zinc-500">No users</div>
        )}
        {users.map((u) => {
          const name = `${u.firstName || ""} ${u.lastName || ""}`.trim() || `User ${u.id}`;
          return (
            <button
              key={u.id}
              onClick={() => onPick(u.id)}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-zinc-50"
            >
              {name}
            </button>
          );
        })}
      </div>
    </>
  );
}
