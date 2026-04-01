import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, Camera } from 'lucide-react';

export function HarvestInput() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    grass: '',
    harvestType: '',
    quantity: '',
    zone: '',
    farm: '',
    project: '',
    estimatedDate: '',
    actualDate: '',
    deliveryDate: '',
    doSoNumber: '',
    truckNote: '',
    licensePlate: '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Handle form submission
    alert('Harvest recorded successfully!');
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
          <h1 className="text-xl font-medium">New Harvest</h1>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Grass Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Grass
            </label>
            <select
              value={formData.grass}
              onChange={(e) => setFormData({ ...formData, grass: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent"
              required
            >
              <option value="">Select grass type</option>
              <option value="Bermuda 419">Bermuda 419</option>
              <option value="Tifway 419">Tifway 419</option>
              <option value="SeaDwarf">SeaDwarf</option>
              <option value="Zeon Zoysia">Zeon Zoysia</option>
              <option value="Meyer Zoysia">Meyer Zoysia</option>
            </select>
          </div>

          {/* Harvest Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Harvest Type
            </label>
            <select
              value={formData.harvestType}
              onChange={(e) => setFormData({ ...formData, harvestType: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent"
              required
            >
              <option value="">Select harvest type</option>
              <option value="Sod">Sod</option>
              <option value="Sprig">Sprig</option>
            </select>
          </div>

          {/* Quantity */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Quantity
            </label>
            <input
              type="number"
              value={formData.quantity}
              onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent"
              placeholder="Enter quantity (sq. ft.)"
              required
            />
          </div>

          {/* Zone */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Zone
            </label>
            <select
              value={formData.zone}
              onChange={(e) => setFormData({ ...formData, zone: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent"
              required
            >
              <option value="">Select zone</option>
              <option value="A">Zone A</option>
              <option value="B">Zone B</option>
              <option value="C">Zone C</option>
              <option value="D">Zone D</option>
            </select>
          </div>

          {/* Farm */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Farm
            </label>
            <select
              value={formData.farm}
              onChange={(e) => setFormData({ ...formData, farm: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent"
              required
            >
              <option value="">Select farm</option>
              <option value="North Farm">North Farm</option>
              <option value="South Farm">South Farm</option>
              <option value="East Farm">East Farm</option>
              <option value="West Farm">West Farm</option>
            </select>
          </div>

          {/* Project */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Project
            </label>
            <select
              value={formData.project}
              onChange={(e) => setFormData({ ...formData, project: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent"
              required
            >
              <option value="">Select project</option>
              <option value="Pebble Beach Renovation">Pebble Beach Renovation</option>
              <option value="Augusta National">Augusta National</option>
              <option value="Pinehurst No. 2">Pinehurst No. 2</option>
              <option value="St. Andrews Links">St. Andrews Links</option>
            </select>
          </div>

          {/* Estimated Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Estimated Date
            </label>
            <input
              type="date"
              value={formData.estimatedDate}
              onChange={(e) => setFormData({ ...formData, estimatedDate: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent"
              required
            />
          </div>

          {/* Actual Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Actual Date
            </label>
            <input
              type="date"
              value={formData.actualDate}
              onChange={(e) => setFormData({ ...formData, actualDate: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent"
            />
          </div>

          {/* Delivery Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Delivery Date
            </label>
            <input
              type="date"
              value={formData.deliveryDate}
              onChange={(e) => setFormData({ ...formData, deliveryDate: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent"
            />
          </div>

          {/* DO/SO Number */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              DO/SO Number
            </label>
            <input
              type="text"
              value={formData.doSoNumber}
              onChange={(e) => setFormData({ ...formData, doSoNumber: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent"
              placeholder="Enter DO/SO number"
            />
          </div>

          {/* Truck Note */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Truck Note
            </label>
            <textarea
              value={formData.truckNote}
              onChange={(e) => setFormData({ ...formData, truckNote: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent"
              rows={3}
              placeholder="Enter any notes about the truck"
            />
          </div>

          {/* License Plate */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              License Plate
            </label>
            <input
              type="text"
              value={formData.licensePlate}
              onChange={(e) => setFormData({ ...formData, licensePlate: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent"
              placeholder="Enter license plate number"
            />
          </div>

          {/* Photo Grid */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Documentation Photos
            </label>
            <div className="grid grid-cols-3 gap-3">
              {['Payment', 'Shipping', 'Thermostat', 'Plate', 'Cutting', 'Loaded'].map((label) => (
                <button
                  key={label}
                  type="button"
                  className="aspect-square bg-gray-100 rounded-lg border-2 border-dashed border-gray-300 hover:border-[#1F7A4C] hover:bg-gray-50 transition-colors flex flex-col items-center justify-center gap-1"
                >
                  <Camera className="w-6 h-6 text-gray-400" />
                  <span className="text-xs text-gray-600">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            className="w-full py-3 bg-[#1F7A4C] text-white rounded-lg font-medium hover:bg-[#196A40] transition-colors mt-6"
          >
            Save Harvest
          </button>
        </form>
      </div>
    </div>
  );
}
