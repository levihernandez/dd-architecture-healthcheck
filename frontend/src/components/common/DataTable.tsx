import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, horizontalListSortingStrategy, useSortable, arrayMove, sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  width?: string;
  sortable?: boolean;
  sortAccessor?: (row: T) => string | number;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  className?: string;
  /** Enables persisted, drag-to-reorder column order. Must be unique per table. */
  tableId?: string;
  /** Enables checkbox multi-select + a bulk-action bar above the table. */
  selectable?: boolean;
  bulkActions?: (selectedRows: T[], clearSelection: () => void) => React.ReactNode;
}

function readColumnOrder(tableId: string): string[] | null {
  try {
    const raw = localStorage.getItem(`dd-hc:table-cols:${tableId}`);
    return raw ? (JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
}

function writeColumnOrder(tableId: string, order: string[]) {
  try {
    localStorage.setItem(`dd-hc:table-cols:${tableId}`, JSON.stringify(order));
  } catch {
    /* ignore */
  }
}

function orderColumns<T>(columns: Column<T>[], tableId?: string): Column<T>[] {
  if (!tableId) return columns;
  const saved = readColumnOrder(tableId);
  if (!saved) return columns;
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const ordered = saved.map((k) => byKey.get(k)).filter((c): c is Column<T> => Boolean(c));
  const missing = columns.filter((c) => !saved.includes(c.key));
  return [...ordered, ...missing];
}

function SortableHeader<T>({
  column, draggable, sortDir, onSort,
}: { column: Column<T>; draggable: boolean; sortDir?: 'asc' | 'desc'; onSort?: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: column.key, disabled: !draggable });

  return (
    <th
      ref={setNodeRef}
      style={{ width: column.width, transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className={clsx(
        'px-4 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider select-none whitespace-nowrap',
        column.sortable && 'cursor-pointer hover:text-ink'
      )}
    >
      <span className="inline-flex items-center gap-1">
        {draggable && (
          <span {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-ink-faint mr-0.5" aria-label={`Drag to reorder ${column.header} column`}>
            ⠿
          </span>
        )}
        <span onClick={column.sortable ? onSort : undefined}>{column.header}</span>
        {column.sortable && sortDir && <span className="text-dd-purple">{sortDir === 'asc' ? '↑' : '↓'}</span>}
      </span>
    </th>
  );
}

export default function DataTable<T>({
  columns: rawColumns, data, rowKey, onRowClick, emptyMessage = 'No data', className,
  tableId, selectable, bulkActions,
}: DataTableProps<T>) {
  const [columnOrder, setColumnOrder] = useState<string[]>(() =>
    tableId ? orderColumns(rawColumns, tableId).map((c) => c.key) : rawColumns.map((c) => c.key)
  );
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    setColumnOrder((prev) => {
      const known = new Set(rawColumns.map((c) => c.key));
      const kept = prev.filter((k) => known.has(k));
      const added = rawColumns.map((c) => c.key).filter((k) => !kept.includes(k));
      return [...kept, ...added];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawColumns.map((c) => c.key).join(',')]);

  const columns = useMemo(() => {
    const byKey = new Map(rawColumns.map((c) => [c.key, c]));
    return columnOrder.map((k) => byKey.get(k)).filter((c): c is Column<T> => Boolean(c));
  }, [columnOrder, rawColumns]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleColumnDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setColumnOrder((prev) => {
      const next = arrayMove(prev, prev.indexOf(String(active.id)), prev.indexOf(String(over.id)));
      if (tableId) writeColumnOrder(tableId, next);
      return next;
    });
  }

  const sortedData = useMemo(() => {
    if (!sort) return data;
    const col = rawColumns.find((c) => c.key === sort.key);
    if (!col) return data;
    const accessor = col.sortAccessor ?? ((row: T) => (row as Record<string, unknown>)[col.key] as string | number);
    return [...data].sort((a, b) => {
      const av = accessor(a);
      const bv = accessor(b);
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av ?? '').localeCompare(String(bv ?? ''));
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [data, sort, rawColumns]);

  function toggleSort(key: string) {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return null;
    });
  }

  function toggleRow(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === sortedData.length ? new Set() : new Set(sortedData.map(rowKey))));
  }

  const selectedRows = sortedData.filter((row) => selected.has(rowKey(row)));

  return (
    <div className={className}>
      {selectable && selected.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 mb-2 rounded-lg bg-dd-purple/5 border border-dd-purple/20 animate-fade-in">
          <span className="text-sm font-medium text-dd-purple">{selected.size} selected</span>
          <div className="flex items-center gap-2">{bulkActions?.(selectedRows, () => setSelected(new Set()))}</div>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-xs text-ink-faint hover:text-ink">
            Clear
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleColumnDragEnd}>
        <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-subtle border-b border-border sticky top-0 z-10">
                {selectable && (
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={sortedData.length > 0 && selected.size === sortedData.length}
                      onChange={toggleAll}
                      aria-label="Select all rows"
                      className="rounded border-border-strong"
                    />
                  </th>
                )}
                <SortableContext items={columns.map((c) => c.key)} strategy={horizontalListSortingStrategy}>
                  {columns.map((col) => (
                    <SortableHeader
                      key={col.key}
                      column={col}
                      draggable={Boolean(tableId)}
                      sortDir={sort?.key === col.key ? sort.dir : undefined}
                      onSort={() => toggleSort(col.key)}
                    />
                  ))}
                </SortableContext>
              </tr>
            </thead>
          <tbody className="bg-white divide-y divide-border">
            {sortedData.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (selectable ? 1 : 0)} className="px-4 py-12 text-center text-ink-faint">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              sortedData.map((row) => {
                const key = rowKey(row);
                return (
                  <tr
                    key={key}
                    tabIndex={onRowClick ? 0 : undefined}
                    onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter') onRowClick(row); } : undefined}
                    className={clsx(
                      'hover:bg-surface-subtle transition-colors',
                      onRowClick && 'cursor-pointer',
                      selected.has(key) && 'bg-dd-purple/5'
                    )}
                    onClick={() => onRowClick?.(row)}
                  >
                    {selectable && (
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected.has(key)}
                          onChange={() => toggleRow(key)}
                          aria-label="Select row"
                          className="rounded border-border-strong"
                        />
                      </td>
                    )}
                    {columns.map((col) => (
                      <td key={col.key} className="px-4 py-3 text-ink">
                        {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? '')}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        </DndContext>
      </div>
    </div>
  );
}

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  total: number;
  pageSize: number;
}

export function Pagination({ page, totalPages, onPageChange, total, pageSize }: PaginationProps) {
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-white">
      <span className="text-sm text-ink-muted">
        Showing {start}–{end} of {total}
      </span>
      <div className="flex gap-1">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="px-3 py-1 rounded text-sm border border-border-strong disabled:opacity-40 hover:bg-surface-subtle"
        >
          ←
        </button>
        <span className="px-3 py-1 text-sm">
          {page} / {totalPages}
        </span>
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="px-3 py-1 rounded text-sm border border-border-strong disabled:opacity-40 hover:bg-surface-subtle"
        >
          →
        </button>
      </div>
    </div>
  );
}
