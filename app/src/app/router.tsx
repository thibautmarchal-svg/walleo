import { createBrowserRouter } from 'react-router-dom'
import { Dashboard } from './Dashboard'
import { CardDetail } from './CardDetail'
import { CardForm } from './CardForm'
import { Settings } from './Settings'
import { Import } from './Import'
import { Scanner } from '@/features/scanner/Scanner'

export const router = createBrowserRouter([
  { path: '/', element: <Dashboard /> },
  { path: '/card/:id', element: <CardDetail /> },
  { path: '/card/:id/edit', element: <CardForm mode="edit" /> },
  { path: '/add', element: <CardForm mode="add" /> },
  { path: '/scan', element: <Scanner /> },
  { path: '/import', element: <Import /> },
  { path: '/settings', element: <Settings /> },
])
