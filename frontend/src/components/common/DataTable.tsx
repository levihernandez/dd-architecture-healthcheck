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
  /** Text matched against the search box. Falls back to sortAccessor, then the raw field. */
  searchAccessor?: (row: T) => string;
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
  /** Shows a free-text search box that filters across all columns. Client-side — skip this on tables whose data is already server-searched. */
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Enables built-in client-side pagination at this page size. Skip on tables whose data is already server-paginated. */
  pageSize?: number;
}

type SortRule = { key: string; dir: 'asc' | 'desc' };

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

function rawField<T>(row: T, key: string): unknown {
  return (row as Record<string, unknown>)[key];
}

function sortValue<T>(col: Column<T>, row: T): string | number {
  if (col.sortAccessor) return col.sortAccessor(row);
  return rawField(row, col.key) as string | number;
}

function searchText<T>(col: Column<T>, row: T): string {
  if (col.searchAccessor) return col.searchAccessor(row);
  if (col.sortAccessor) return String(col.sortAccessor(row) ?? '');
  return String(rawField(row, col.key) ?? '');
}

function SortableHeader<T>({
  column, draggable, sortRule, sortPriority, onSort,
}: { column: Column<T>; draggable: boolean; sortRule?: 'asc' | 'desc'; sortPriority?: number; onSort?: (additive: boolean) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: column.key, disabled: !draggable });

  return (
    <th
      ref={setNodeRef}
      style={{ width: column.width, transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className={clsx(
        'px-4 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider select-none whitespace-nowrap',
        column.sortable && 'cursor-pointer hover:text-ink'
      )}
      title={column.sortable ? 'Click to sort · shift-click to add a secondary sort' : undefined}
      onClick={column.sortable ? (e) => onSort?.(e.shiftKey) : undefined}
    >
      <span className="flex items-center gap-1 w-full">
        {draggable && (
          <span
            {...attributes}
            {...listeners}
            onClick={(e) => e.stopPropagation()}
            className="cursor-grab active:cursor-grabbing text-ink-faint mr-0.5"
            aria-label={`Drag to reorder ${column.header} column`}
          >
            ⠿
          </span>
        )}
        <span>{column.header}</span>
        {column.sortable && sortRule && (
          <span className="text-dd-purple inline-flex items-center gap-0.5">
            {sortRule === 'asc' ? '↑' : '↓'}
            {sortPriority !== undefined && sortPriority > 0 && (
              <sup className="text-[9px] font-bold">{sortPriority + 1}</sup>
            )}
          </span>
        )}
      </span>
    </th>
  );
}

export default function DataTable<T>({
  columns: rawColumns, data, rowKey, onRowClick, emptyMessage = 'No data', className,
  tableId, selectable, bulkActions, searchable, searchPlaceholder = 'Search…', pageSize,
}: DataTableProps<T>) {
  const [columnOrder, setColumnOrder] = useState<string[]>(() =>
    tableId ? orderColumns(rawColumns, tableId).map((c) => c.key) : rawColumns.map((c) => c.key)
  );
  const [sorts, setSorts] = useState<SortRule[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

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

  const filteredData = useMemo(() => {
    if (!searchable || !query.trim()) return data;
    const q = query.trim().toLowerCase();
    return data.filter((row) => columns.some((col) => searchText(col, row).toLowerCase().includes(q)));
  }, [data, columns, searchable, query]);

  const sortedData = useMemo(() => {
    if (sorts.length === 0) return filteredData;
    return [...filteredData].sort((a, b) => {
      for (const rule of sorts) {
        const col = rawColumns.find((c) => c.key === rule.key);
        if (!col) continue;
        const av = sortValue(col, a);
        const bv = sortValue(col, b);
        const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av ?? '').localeCompare(String(bv ?? ''));
        if (cmp !== 0) return rule.dir === 'asc' ? cmp : -cmp;
      }
      return 0;
    });
  }, [filteredData, sorts, rawColumns]);

  useEffect(() => {
    setPage(1);
  }, [query, data]);

  const totalPages = pageSize ? Math.max(1, Math.ceil(sortedData.length / pageSize)) : 1;
  const clampedPage = Math.min(page, totalPages);
  const pagedData = pageSize ? sortedData.slice((clampedPage - 1) * pageSize, clampedPage * pageSize) : sortedData;

  function toggleSort(key: string, additive: boolean) {
    setSorts((prev) => {
      const existing = prev.find((s) => s.key === key);
      if (!additive) {
        if (!existing) return [{ key, dir: 'asc' }];
        if (existing.dir === 'asc') return [{ key, dir: 'desc' }];
        return [];
      }
      if (!existing) return [...prev, { key, dir: 'asc' }];
      if (existing.dir === 'asc') return prev.map((s) => (s.key === key ? { key, dir: 'desc' } : s));
      return prev.filter((s) => s.key !== key);
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
    const allOnPageSelected = pagedData.length > 0 && pagedData.every((row) => selected.has(rowKey(row)));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const row of pagedData) {
        const key = rowKey(row);
        if (allOnPageSelected) next.delete(key); else next.add(key);
      }
      return next;
    });
  }

  const selectedRows = sortedData.filter((row) => selected.has(rowKey(row)));
  const allOnPageSelected = pagedData.length > 0 && pagedData.every((row) => selected.has(rowKey(row)));

  return (
    <div className={className}>
      {(searchable || (selectable && selected.size > 0)) && (
        <div className="flex items-center gap-3 mb-2 flex-wrap">
          {selectable && selected.size > 0 && (
            <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-dd-purple/5 border border-dd-purple/20 animate-fade-in flex-1">
              <span className="text-sm font-medium text-dd-purple">{selected.size} selected</span>
              <div className="flex items-center gap-2">{bulkActions?.(selectedRows, () => setSelected(new Set()))}</div>
              <button onClick={() => setSelected(new Set())} className="ml-auto text-xs text-ink-faint hover:text-ink">
                Clear
              </button>
            </div>
          )}
          {searchable && (!selectable || selected.size === 0) && (
            <div className="relative ml-auto">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="input w-56 text-sm pl-7"
              />
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint text-xs">⌕</span>
            </div>
          )}
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
                      checked={allOnPageSelected}
                      onChange={toggleAll}
                      aria-label="Select all rows on this page"
                      className="rounded border-border-strong"
                    />
                  </th>
                )}
                <SortableContext items={columns.map((c) => c.key)} strategy={horizontalListSortingStrategy}>
                  {columns.map((col) => {
                    const ruleIndex = sorts.findIndex((s) => s.key === col.key);
                    return (
                      <SortableHeader
                        key={col.key}
                        column={col}
                        draggable={Boolean(tableId)}
                        sortRule={ruleIndex >= 0 ? sorts[ruleIndex].dir : undefined}
                        sortPriority={sorts.length > 1 && ruleIndex >= 0 ? ruleIndex : undefined}
                        onSort={(additive) => toggleSort(col.key, additive)}
                      />
                    );
                  })}
                </SortableContext>
              </tr>
            </thead>
          <tbody className="bg-surface-subtle divide-y divide-border">
            {pagedData.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (selectable ? 1 : 0)} className="px-4 py-12 text-center text-ink-faint">
                  {data.length > 0 ? 'No rows match your search' : emptyMessage}
                </td>
              </tr>
            ) : (
              pagedData.map((row) => {
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

      {pageSize && sortedData.length > 0 && (
        <Pagination
          page={clampedPage}
          totalPages={totalPages}
          onPageChange={setPage}
          total={sortedData.length}
          pageSize={pageSize}
        />
      )}
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
    <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-surface-subtle">
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
