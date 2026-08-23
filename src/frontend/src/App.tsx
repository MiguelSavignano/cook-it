import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Picker from './pages/Picker';
import Cook from './pages/Cook';
import Recipe from './pages/Recipe';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Picker />} />
        <Route path="/cook" element={<Cook />} />
        {/* A recipe's own address -- the URL you send someone. Short on
            purpose ("/r/..."): it gets pasted into messages. */}
        <Route path="/r/:uuid" element={<Recipe />} />
      </Routes>
    </BrowserRouter>
  );
}
