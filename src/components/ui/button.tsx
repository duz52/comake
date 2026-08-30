import { Button as BaseButton } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[background,color,transform] outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-neutral-100 text-neutral-950 hover:bg-white',
        ghost: 'bg-transparent text-neutral-300 hover:bg-white/8 hover:text-white',
        outline: 'border border-white/20 bg-transparent text-neutral-100 hover:bg-white/8',
        ember: 'bg-[#ec6f42] text-[#1d1d18] hover:-translate-y-px hover:bg-[#ff8157]',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface ButtonProps
  extends ComponentProps<typeof BaseButton>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, ...props }: ButtonProps) {
  return <BaseButton className={cn(buttonVariants({ variant }), className)} {...props} />;
}
