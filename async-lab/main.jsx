import React from 'react';
import { createRoot } from 'react-dom/client';
import AsyncLab from './async-lab.jsx';

// No StrictMode on purpose: the exercises fire real timers/promises, and the dev
// double-invoke would run each driver twice and double every call count.
createRoot(document.getElementById('root')).render(<AsyncLab />);
