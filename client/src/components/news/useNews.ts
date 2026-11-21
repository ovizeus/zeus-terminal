import { useEffect, useState } from 'react'
import { subscribeNews, getNews, type NewsSnap } from '../../markets/news'

/** Datele MARKET NEWS, impartite intre caseta si panou. `fast` = panoul e deschis. */
export function useNews(fast = false): { snap: NewsSnap | null; err: string | null } {
  const [st, setSt] = useState(getNews)
  useEffect(() => subscribeNews(() => setSt({ ...getNews() }), fast), [fast])
  return st
}
