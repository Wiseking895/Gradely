import logo from '../images/wiseGrade.jpeg'

type BrandMarkProps = {
  className?: string
  variant?: 'header' | 'auth'
}

const sizeClasses: Record<NonNullable<BrandMarkProps['variant']>, string> = {
  header: 'h-14 w-14 sm:h-16 sm:w-16',
  auth: 'h-32 w-32 sm:h-36 sm:w-36',
}

/**
 * Official project logo lockup. The source image is square, so `object-contain`
 * preserves its proportions at both the compact header size and the larger
 * auth-page size.
 */
export default function BrandMark({
  className = '',
  variant = 'auth',
}: BrandMarkProps) {
  return (
    <img
      src={logo}
      alt="Gradely"
      width={1254}
      height={1254}
      decoding="async"
      className={`${sizeClasses[variant]} shrink-0 object-contain ${className}`}
    />
  )
}
