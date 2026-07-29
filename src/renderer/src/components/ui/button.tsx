import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Bottone (§4.1). Quattro varianti, tre taglie, cinque stati raggiungibili —
 * incluso "working", che disabilita il bottone senza farlo sembrare rotto.
 * Il target minimo è 28×28; i percorsi distruttivi usano `lg` (40px).
 */
const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control',
    'font-medium transition-[background-color,border-color,color,transform,box-shadow]',
    'duration-press ease-out active:translate-y-px',
    'disabled:pointer-events-none disabled:opacity-45',
    '[&_svg]:size-[15px] [&_svg]:shrink-0'
  ].join(' '),
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-ink shadow-e1 hover:bg-accent-hover',
        secondary:
          'border border-line bg-surface-3 text-ink-hi shadow-e1 hover:border-line-strong hover:bg-surface-hover',
        ghost: 'text-ink-mid hover:bg-surface-hover hover:text-ink-hi',
        /* Due stadi: a riposo bordo e testo rossi su fondo appena tinto, a
           hover il rosso pieno. Un bottone che è già un blocco rosso mentre
           l'utente sta ancora leggendo la pagina urla prima di avere qualcosa
           da dire, e a furia di urlare non lo si guarda più. */
        destructive:
          'border border-destructive/45 bg-destructive/10 text-destructive font-medium ' +
          'hover:border-transparent hover:bg-destructive hover:text-destructive-ink hover:font-semibold',
        /* usato solo dove l'azione è già armata da una conferma esplicita */
        warning: 'bg-warning text-warning-ink shadow-e1 hover:bg-warning/88'
      },
      size: {
        sm: 'h-7 px-2.5 text-caption',
        md: 'h-[34px] px-3.5 text-body',
        lg: 'h-10 px-5 text-body',
        icon: 'h-[34px] w-[34px]',
        'icon-sm': 'h-7 w-7'
      }
    },
    defaultVariants: { variant: 'secondary', size: 'md' }
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** mostra lo spinner e blocca il click, senza cambiare larghezza */
  working?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, working, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size }), className)}
        ref={ref}
        disabled={disabled || working}
        {...props}
      >
        {working ? (
          <>
            <Loader2 className="animate-spin" />
            {children}
          </>
        ) : (
          children
        )}
      </Comp>
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
