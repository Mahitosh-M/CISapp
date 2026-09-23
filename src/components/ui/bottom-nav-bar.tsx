"use client";

import { useState } from 'react';
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

  const contents = (item: BottomNavItem, isActive: boolean) => {
    const Icon = item.icon;
    return <>
      <Icon size={22} strokeWidth={2} aria-hidden="true" />
      <span className="cis-bottom-nav-label" aria-hidden={!isActive}>
        <span>{item.label}</span>
      </span>
    </>;
  };

  return <nav aria-label={ariaLabel}
    className={cn('cis-bottom-nav flex items-center rounded-full shadow-xl',
      stickyBottom && 'cis-bottom-nav-sticky', className)}>
    {items.map((item, index) => item.to ? (
      <NavLink key={item.to} to={item.to} end={item.end} aria-label={item.label} title={item.label}
        className={({ isActive }) => cn('cis-bottom-nav-item', isActive && 'is-active')}>
        {({ isActive }) => contents(item, isActive)}
      </NavLink>
    ) : (
      <button key={item.label} type="button" aria-label={item.label} title={item.label}
        aria-pressed={activeIndex === index}
        className={cn('cis-bottom-nav-item', activeIndex === index && 'is-active')}
        onClick={() => setActiveIndex(index)}>
        {contents(item, activeIndex === index)}
      </button>
    ))}
  </nav>;
}

export default BottomNavBar;
