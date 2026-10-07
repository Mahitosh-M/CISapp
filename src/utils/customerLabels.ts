type CustomerLabelSource = {
  name?: string;
  customerName?: string;
  area?: string;
  customerArea?: string;
  mobile?: string;
};

export const formatCustomerSelectLabel = (customer: CustomerLabelSource, includeMobile = false) => {
  const name = customer.name || customer.customerName || 'Unnamed customer';
  const area = customer.area || customer.customerArea || 'No area';
  const mobile = includeMobile && customer.mobile ? ` - ${customer.mobile}` : '';

  return `${name} - ${area}${mobile}`;
};

// Resolve by stable ID: saved names are snapshots and may belong to different
// customers with the same name. Keep the snapshot when its customer is missing.
export const withCurrentCustomerNames = <T extends { customerId?: string; customerName: string }>(
  records: T[],
  customers: { id: string; name: string }[]
): T[] => {
  const names = new Map(customers.filter((customer) => customer.name.trim()).map((customer) => [customer.id, customer.name]));
  return records.map((record) => {
    const currentName = record.customerId ? names.get(record.customerId) : undefined;
    return currentName && currentName !== record.customerName
      ? { ...record, customerName: currentName }
      : record;
  });
};
