import { RefObject, useEffect } from 'react';

const normalizeLabel = (value: string) => value.replace(/\s+/g, ' ').trim();

const applyResponsiveLabels = (root: HTMLElement) => {
  const tables = root.querySelectorAll<HTMLTableElement>('table');

  tables.forEach((table) => {
    if (table.classList.contains('audit-log-table')) {
      return;
    }

    const headerCells = Array.from(table.querySelectorAll<HTMLTableCellElement>('thead th'));
    if (headerCells.length === 0) {
      return;
    }

    const labels = headerCells.map((cell, index) => {
      const text = normalizeLabel(cell.textContent || '');
      return text || `Column ${index + 1}`;
    });

    table.classList.add('mobile-stack-table');

    const rows = table.querySelectorAll<HTMLTableRowElement>('tbody tr');
    rows.forEach((row) => {
      const cells = Array.from(row.children).filter(
        (node) => node.tagName.toLowerCase() === 'td'
      ) as HTMLTableCellElement[];

      cells.forEach((cell, index) => {
        const currentLabel = normalizeLabel(cell.getAttribute('data-label') || '');
        if (currentLabel) {
          return;
        }

        const resolvedLabel = labels[index] || `Column ${index + 1}`;
        cell.setAttribute('data-label', resolvedLabel);
      });
    });
  });
};

export const useResponsiveTableLabels = (rootRef: RefObject<HTMLElement>) => {
  useEffect(() => {
    if (!rootRef.current) {
      return;
    }

    const root = rootRef.current;
    const apply = () => applyResponsiveLabels(root);

    apply();

    const observer = new MutationObserver(() => apply());
    observer.observe(root, { childList: true, subtree: true });

    window.addEventListener('resize', apply);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', apply);
    };
  }, [rootRef]);
};
