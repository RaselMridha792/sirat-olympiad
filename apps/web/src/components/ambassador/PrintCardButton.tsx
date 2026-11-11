'use client';
import { Printer } from 'lucide-react';
import { Button } from '@sirat/ui';

/** Opens the browser's print dialog; the page's print rule (globals.css) prints only the ID card. */
export function PrintCardButton({ label }: { label: string }) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
      <Printer aria-hidden="true" size={16} />
      {label}
    </Button>
  );
}
