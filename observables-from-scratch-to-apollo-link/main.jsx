import React from 'react';
import { createRoot } from 'react-dom/client';
import ObservableLab from './observable-lab.jsx';

// No StrictMode on purpose: the lessons run real timers/subscriptions, and the
// dev double-invoke would fire each lesson twice and muddy the marble tracks.
createRoot(document.getElementById('root')).render(<ObservableLab />);
