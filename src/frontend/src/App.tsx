import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Picker from './pages/Picker';
import Cook from './pages/Cook';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Picker />} />
        <Route path="/cook" element={<Cook />} />
      </Routes>
    </BrowserRouter>
  );
}
