import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';

interface GrassRow {
  id: string;
  grass: string;
  type: string;
  required: string;
  delivered: string;
}

export function ProjectInput() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    projectName: '',
    golfClub: '',
    company: '',
    architect: '',
    country: '',
    stsPic: '',
    projectType: '',
    holes: '',
  });

  const [grassRows, setGrassRows] = useState<GrassRow[]>([
    { id: '1', grass: '', type: '', required: '', delivered: '' }
  ]);

  const addGrassRow = () => {
    setGrassRows([
      ...grassRows,
      { id: Date.now().toString(), grass: '', type: '', required: '', delivered: '' }
    ]);
  };

  const removeGrassRow = (id: string) => {
    if (grassRows.length > 1) {
      setGrassRows(grassRows.filter(row => row.id !== id));
    }
  };

  const updateGrassRow = (id: string, field: keyof GrassRow, value: string) => {
    setGrassRows(grassRows.map(row =>
      row.id === id ? { ...row, [field]: value } : row
    ));
  };

  const calculateRemaining = (required: string, delivered: string) => {
    const req = parseFloat(required) || 0;
    const del = parseFloat(delivered) || 0;
    return req - del;
  };

  const calculateComplete = (required: string, delivered: string) => {
    const req = parseFloat(required) || 0;
    const del = parseFloat(delivered) || 0;
    if (req === 0) return 0;
    return Math.min(100, Math.round((del / req) * 100));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    alert('Project created successfully!');
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <div className="max-w-md mx-auto">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-4 py-4 flex items-center gap-3 sticky top-0 z-10">
          <button
            onClick={() => navigate('/')}
            className="p-2 -ml-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-medium">New Project</h1>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Project Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Project Name
            </label>
            <input
              type="text"
              value={formData.projectName}
              onChange={(e) => setFormData({ ...formData, projectName: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent"
              placeholder="Enter project name"
              required
            />
          </div>

          {/* Golf Club */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Golf Club
            </label>
            <input
              type="text"
              value={formData.golfClub}
              onChange={(e) => setFormData({ ...formData, golfClub: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent"
              placeholder="Enter golf club name"
              required
            />
          </div>

          {/* Company */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Company
            </label>
            <input
              type="text"
              value={formData.company}
              onChange={(e) => setFormData({ ...formData, company: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent"
              placeholder="Enter company name"
              required
            />
          </div>

          {/* Architect */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Architect
            </label>
            <input
              type="text"
              value={formData.architect}
              onChange={(e) => setFormData({ ...formData, architect: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent"
              placeholder="Enter architect name"
            />
          </div>

          {/* Country */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Country
            </label>
            <select
              value={formData.country}
              onChange={(e) => setFormData({ ...formData, country: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent"
              required
            >
              <option value="">Select country</option>
              <option value="USA">USA</option>
              <option value="UK">United Kingdom</option>
              <option value="Scotland">Scotland</option>
              <option value="Ireland">Ireland</option>
              <option value="Australia">Australia</option>
              <option value="Japan">Japan</option>
              <option value="South Korea">South Korea</option>
            </select>
          </div>

          {/* STS PIC */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              STS PIC
            </label>
            <input
              type="text"
              value={formData.stsPic}
              onChange={(e) => setFormData({ ...formData, stsPic: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent"
              placeholder="Person in charge"
              required
            />
          </div>

          {/* Project Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Project Type
            </label>
            <select
              value={formData.projectType}
              onChange={(e) => setFormData({ ...formData, projectType: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent"
              required
            >
              <option value="">Select project type</option>
              <option value="New Construction">New Construction</option>
              <option value="Renovation">Renovation</option>
              <option value="Restoration">Restoration</option>
              <option value="Maintenance">Maintenance</option>
            </select>
          </div>

          {/* Number of Holes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              No. of Holes
            </label>
            <input
              type="number"
              value={formData.holes}
              onChange={(e) => setFormData({ ...formData, holes: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent"
              placeholder="e.g., 18"
              min="1"
              max="36"
              required
            />
          </div>

          {/* Grass Requirements Section */}
          <div className="pt-4 border-t border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-medium text-gray-700">
                Grass Requirements
              </label>
              <button
                type="button"
                onClick={addGrassRow}
                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-[#1F7A4C] text-white rounded-lg hover:bg-[#196A40] transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add
              </button>
            </div>

            {grassRows.map((row) => (
              <div key={row.id} className="mb-4 p-4 bg-white rounded-lg border border-gray-200">
                <div className="flex justify-between items-start mb-3">
                  <span className="text-sm font-medium text-gray-700">Grass Type</span>
                  {grassRows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeGrassRow(row.id)}
                      className="p-1 text-red-600 hover:bg-red-50 rounded"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <div className="space-y-3">
                  <select
                    value={row.grass}
                    onChange={(e) => updateGrassRow(row.id, 'grass', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent text-sm"
                    required
                  >
                    <option value="">Select grass</option>
                    <option value="Bermuda 419">Bermuda 419</option>
                    <option value="Tifway 419">Tifway 419</option>
                    <option value="SeaDwarf">SeaDwarf</option>
                    <option value="Zeon Zoysia">Zeon Zoysia</option>
                  </select>

                  <select
                    value={row.type}
                    onChange={(e) => updateGrassRow(row.id, 'type', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent text-sm"
                    required
                  >
                    <option value="">Sprig/Sod</option>
                    <option value="Sprig">Sprig</option>
                    <option value="Sod">Sod</option>
                  </select>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Required (sq. ft.)</label>
                      <input
                        type="number"
                        value={row.required}
                        onChange={(e) => updateGrassRow(row.id, 'required', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent text-sm"
                        placeholder="0"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Delivered (sq. ft.)</label>
                      <input
                        type="number"
                        value={row.delivered}
                        onChange={(e) => updateGrassRow(row.id, 'delivered', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent text-sm"
                        placeholder="0"
                      />
                    </div>
                  </div>

                  {/* Calculated Fields */}
                  <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-100">
                    <div>
                      <span className="block text-xs text-gray-600 mb-1">Remaining</span>
                      <div className="px-3 py-2 bg-gray-50 rounded-lg text-sm font-medium">
                        {calculateRemaining(row.required, row.delivered).toLocaleString()} sq. ft.
                      </div>
                    </div>
                    <div>
                      <span className="block text-xs text-gray-600 mb-1">% Complete</span>
                      <div className="px-3 py-2 bg-gray-50 rounded-lg text-sm font-medium">
                        {calculateComplete(row.required, row.delivered)}%
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            className="w-full py-3 bg-[#1F7A4C] text-white rounded-lg font-medium hover:bg-[#196A40] transition-colors mt-6"
          >
            Create Project
          </button>
        </form>
      </div>
    </div>
  );
}
