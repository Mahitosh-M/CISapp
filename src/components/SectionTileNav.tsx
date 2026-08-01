import type { CSSProperties } from 'react';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useIsMobile } from '../hooks/useIsMobile';

export interface SectionTileItem<T extends string> {
  id: T;
  label: string;
  icon: LucideIcon;
}

interface SectionTileNavProps<T extends string> {
  items: SectionTileItem<T>[];
  activeId: T | null;
  onSelect: (id: T) => void;
  singleRow?: boolean;
}

const SectionTileNav = <T extends string>({ items, activeId, onSelect, singleRow = false }: SectionTileNavProps<T>) => {
  const { userProfile } = useAuth();
  const isMobile = useIsMobile();
  const stackForAdminMobile = isMobile && userProfile?.role === 'Admin';
  const keepSingleRow = !isMobile || singleRow;
  const tileStyle: CSSProperties = {
    width: 'min(100%, 190px)',
    minHeight: 62,
    padding: '9px 12px',
    borderRadius: 8,
    border: '1px solid var(--role-card-border)',
    color: '#FFFFFF',
    display: 'grid',
    gridTemplateColumns: '24px minmax(0, 1fr)',
    alignItems: 'center',
    gap: 9,
    cursor: 'pointer',
    textAlign: 'left',
    fontWeight: 900,
    lineHeight: 1.2,
    letterSpacing: 0
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: stackForAdminMobile ? 'column' : 'row',
        flexWrap: stackForAdminMobile || keepSingleRow ? 'nowrap' : 'wrap',
        alignItems: stackForAdminMobile ? 'flex-start' : 'stretch',
        gap: 10,
        marginBottom: 20,
        overflowX: !stackForAdminMobile && keepSingleRow ? 'auto' : 'visible',
        paddingBottom: !stackForAdminMobile && keepSingleRow ? 4 : 0
      }}
    >
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = item.id === activeId;

        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={isActive}
            style={{
              ...tileStyle,
              flex: !stackForAdminMobile && keepSingleRow ? '0 0 190px' : undefined,
              background: isActive
                ? 'linear-gradient(135deg, #11185A 0%, #111827 100%)'
                : 'var(--role-card-background)',
              borderColor: isActive ? '#D4AF37' : 'var(--role-card-border)'
            }}
            onClick={() => onSelect(item.id)}
          >
            <Icon size={21} color={isActive ? '#D4AF37' : '#FFFFFF'} />
            <span style={{ overflowWrap: 'anywhere' }}>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
};

export default SectionTileNav;
