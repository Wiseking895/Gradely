import { GraduationCap } from 'lucide-react'

type BrandMarkProps = {
  className?: string
}

/**
 * Text wordmark placeholder. The official Gradely logo asset is not present in
 * the project yet, so this renders a typographic mark instead of an image.
 */
export default function BrandMark({ className = '' }: BrandMarkProps) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <span
        aria-hidden="true"
        className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-navy text-white"
      >
        <GraduationCap className="h-5 w-5" strokeWidth={2} />
      </span>
      <span className="text-xl font-bold tracking-tight text-brand-navy">
        Gradely
      </span>
    </div>
  )
}
