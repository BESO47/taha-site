import { useMemo } from 'react'

const PHYSICS_SYMBOLS = [
  'E=mc²',
  'F=ma',
  'V=IR',
  'λ',
  'Ω',
  'ħ',
  'Δt',
  'P=IV',
  'B=μI',
  'ν',
  'q',
  'c',
  '⚛️',
  '⚡',
  '🧲',
  'W=Fd',
  'a=Δv/t',
]

export default function FloatingMathBg() {
  const items = useMemo(() => {
    return Array.from({ length: 24 }).map((_, i) => ({
      id: i,
      symbol: PHYSICS_SYMBOLS[i % PHYSICS_SYMBOLS.length],
      left: `${Math.floor(Math.random() * 95)}%`,
      top: `${Math.floor(Math.random() * 95)}%`,
      size: `${Math.floor(Math.random() * 20) + 14}px`,
      duration: `${Math.floor(Math.random() * 12) + 10}s`,
      delay: `${(Math.random() * 5).toFixed(1)}s`,
      opacity: (Math.random() * 0.16 + 0.08).toFixed(2),
    }))
  }, [])

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0 select-none">
      {items.map((item) => (
        <span
          key={item.id}
          className="absolute font-mono font-bold text-yellow-400 dark:text-yellow-400 animate-float"
          style={{
            left: item.left,
            top: item.top,
            fontSize: item.size,
            opacity: item.opacity,
            animationDuration: item.duration,
            animationDelay: item.delay,
            animationIterationCount: 'infinite',
            animationTimingFunction: 'ease-in-out',
          }}
        >
          {item.symbol}
        </span>
      ))}
    </div>
  )
}
