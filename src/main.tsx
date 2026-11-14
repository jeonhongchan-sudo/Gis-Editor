import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initPwaRegistration } from './utils/pwaRefresh';

initPwaRegistration();

createRoot(document.getElementById('root')!).render(<App />);
