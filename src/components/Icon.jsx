// Material Symbols (Rounded) icon helper — Material 3 expressive iconography.
// Usage: <Icon name="home" /> · <Icon name="play_arrow" size={22} fill weight={600} />
export default function Icon({ name, size = 20, fill = false, weight = 500, grade = 0, className = '', style = {} }) {
  return (
    <span
      className={`material-symbols-rounded ${className}`}
      style={{
        fontSize: size,
        lineHeight: 1,
        userSelect: 'none',
        fontVariationSettings: `'FILL' ${fill ? 1 : 0}, 'wght' ${weight}, 'GRAD' ${grade}, 'opsz' ${size}`,
        ...style,
      }}
    >
      {name}
    </span>
  );
}
