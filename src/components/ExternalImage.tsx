import { useState } from 'react';
import type { CSSProperties } from 'react';

const placeholderImage =
  'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22640%22 height=%22360%22 viewBox=%220 0 640 360%22%3E%3Crect width=%22640%22 height=%22360%22 fill=%22%23F8F9FB%22/%3E%3Cpath d=%22M88 270h464L430 138l-82 88-58-62L88 270Z%22 fill=%22%23D8DEE9%22/%3E%3Ccircle cx=%22202%22 cy=%22124%22 r=%2242%22 fill=%22%23E8EDF4%22/%3E%3Ctext x=%22320%22 y=%22312%22 text-anchor=%22middle%22 font-family=%22Arial%2C sans-serif%22 font-size=%2226%22 font-weight=%22700%22 fill=%22%2367738E%22%3EImage unavailable%3C/text%3E%3C/svg%3E';

interface ExternalImageProps {
  src?: string;
  alt: string;
  style?: CSSProperties;
  className?: string;
}

const ExternalImage = ({ src, alt, style, className }: ExternalImageProps) => {
  const [failed, setFailed] = useState(false);
  const imageSource = !failed && src ? src : placeholderImage;

  return (
    <img
      loading="lazy"
      src={imageSource}
      alt={alt}
      className={className}
      style={style}
      onError={() => setFailed(true)}
    />
  );
};

export default ExternalImage;
