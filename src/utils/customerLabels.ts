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
