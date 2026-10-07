import { describe, expect, it } from 'vitest';
import { withCurrentCustomerNames } from './customerLabels';

describe('current customer names on historical billing records', () => {
  it('uses the linked customer ID for invoices and payments without changing accounting fields or stored snapshots', () => {
    const invoice = { id: 'invoice', customerId: 'a', customerName: 'Old name', totalSales: 500, date: '2025-01-01' };
    const payment = { id: 'payment', customerId: 'a', customerName: 'Old name', invoiceId: 'invoice', amount: 200 };
    const customers = [{ id: 'a', name: 'Updated name' }, { id: 'b', name: 'Old name' }];
    expect(withCurrentCustomerNames([invoice], customers)).toEqual([{ ...invoice, customerName: 'Updated name' }]);
    expect(withCurrentCustomerNames([payment], customers)).toEqual([{ ...payment, customerName: 'Updated name' }]);
    expect(invoice.customerName).toBe('Old name');
    expect(payment.customerName).toBe('Old name');
  });

  it('keeps saved names for deleted, unlinked, and unnamed customers', () => {
    const records = [
      { customerId: 'missing', customerName: 'Deleted customer' },
      { customerName: 'Legacy customer' },
      { customerId: 'blank', customerName: 'Saved customer' }
    ];
    expect(withCurrentCustomerNames(records, [{ id: 'other', name: 'Legacy customer' }, { id: 'blank', name: ' ' }])).toEqual(records);
  });

  it('reflects a second rename when customer data refreshes', () => {
    const records = [{ customerId: 'a', customerName: 'Original' }];
    expect(withCurrentCustomerNames(records, [{ id: 'a', name: 'First rename' }])[0].customerName).toBe('First rename');
    expect(withCurrentCustomerNames(records, [{ id: 'a', name: 'Second rename' }])[0].customerName).toBe('Second rename');
  });
});
