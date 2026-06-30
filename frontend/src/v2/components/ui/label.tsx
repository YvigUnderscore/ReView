import { type LabelHTMLAttributes, forwardRef } from 'react';
import { cn } from '../../lib/utils';

const Label = forwardRef<HTMLLabelElement, LabelHTMLAttributes<HTMLLabelElement>>(({ className, ...props }, ref) => (
  <label ref={ref} className={cn('text-sm font-medium leading-none text-foreground', className)} {...props} />
));
Label.displayName = 'Label';

export { Label };
