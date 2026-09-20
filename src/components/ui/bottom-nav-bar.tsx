"use client";

import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { NavLink } from 'react-router-dom';
import { Home, LineChart, CreditCard, MessageCircle, Trophy, User, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import './bottom-nav-bar.css';

export type BottomNavItem = { label: string; icon: LucideIcon; to?: string; end?: boolean };

const defaultItems: BottomNavItem[] = [
  { label: 'Home', icon: Home },
  { label: 'Portfolio', icon: LineChart },
  { label: 'Transactions', icon: CreditCard },
  { label: 'Messages', icon: MessageCircle },
  { label: 'Rewards', icon: Trophy },
  { label: 'Profile', icon: User }
];

type BottomNavBarProps = {
  className?: string;
  defaultIndex?: number;
  stickyBottom?: boolean;
  items?: BottomNavItem[];
  ariaLabel?: string;
};

export function BottomNavBar({ className, defaultIndex = 0, stickyBottom = false,
  items = defaultItems, ariaLabel = 'Bottom navigation' }: BottomNavBarProps) {
  const [activeIndex, setActiveIndex] = useState(defaultIndex);
  const reduceMotion = useReducedMotion();

  const contents = (item: BottomNavItem, isActive: boolean) => {
    const Icon = item.icon;
    return <>
      <Icon size={22} strokeWidth={2} aria-hidden="true" />
      <motion.span className="cis-bottom-nav-label" aria-hidden="true" initial={false}
        animate={{ width: isActive ? 'auto' : 0, opacity: isActive ? 1 : 0, marginLeft: isActive ? 7 : 0 }}
        transition={reduceMotion ? { duration: 0 } : {
          width: { type: 'spring', stiffness: 350, damping: 32 },
          opacity: { duration: 0.19 }, marginLeft: { duration: 0.19 }
        }}>
        <span>{item.label}</span>
      </motion.span>
    </>;
  };

  return <motion.nav aria-label={ariaLabel}
    initial={reduceMotion ? false : { scale: 0.96, opacity: 0 }}
    animate={{ scale: 1, opacity: 1 }}
    transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 300, damping: 26 }}
    className={cn('cis-bottom-nav flex items-center rounded-full shadow-xl',
      stickyBottom && 'cis-bottom-nav-sticky', className)}>
    {items.map((item, index) => item.to ? (
      <NavLink key={item.to} to={item.to} end={item.end} aria-label={item.label} title={item.label}
        className={({ isActive }) => cn('cis-bottom-nav-item', isActive && 'is-active')}>
        {({ isActive }) => contents(item, isActive)}
      </NavLink>
    ) : (
      <motion.button key={item.label} type="button" aria-label={item.label} title={item.label}
        aria-pressed={activeIndex === index} whileTap={reduceMotion ? undefined : { scale: 0.97 }}
        className={cn('cis-bottom-nav-item', activeIndex === index && 'is-active')}
        onClick={() => setActiveIndex(index)}>
        {contents(item, activeIndex === index)}
      </motion.button>
    ))}
  </motion.nav>;
}

export default BottomNavBar;
