import { forwardRef, type InputHTMLAttributes } from 'react'
import { Search } from 'lucide-react'
import './searchable-select.css'

type SearchFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>

const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField({ className = '', ...props }, ref) {
  return <label className={`arc-search-field ${className}`.trim()}>
    <Search aria-hidden="true" />
    <input {...props} ref={ref} type="search" />
  </label>
})

export default SearchField
