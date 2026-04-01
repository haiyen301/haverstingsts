import { useNavigate } from 'react-router';
import { Plus, BarChart3 } from 'lucide-react';

export function Home() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile View */}
      <div className="lg:hidden max-w-md mx-auto p-4">
        <h1 className="text-2xl font-semibold mb-6 text-gray-900">Turf Harvest</h1>
        
        {/* Action Buttons */}
        <div className="flex gap-3 mb-8">
          <button
            onClick={() => navigate('/harvest/new')}
            className="flex-1 h-20 bg-[#1F7A4C] text-white rounded-lg font-medium flex items-center justify-center gap-2 hover:bg-[#196A40] transition-colors"
          >
            <Plus className="w-5 h-5" />
            New Harvest
          </button>
          <button
            onClick={() => navigate('/project/new')}
            className="flex-1 h-20 bg-white text-[#1F7A4C] rounded-lg font-medium flex items-center justify-center gap-2 border-2 border-[#1F7A4C] hover:bg-gray-50 transition-colors"
          >
            <Plus className="w-5 h-5" />
            New Project
          </button>
        </div>

        {/* Management Section */}
        <div className="mb-4">
          <h2 className="text-base text-gray-700 mb-3">Management</h2>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => navigate('/projects')}
              className="bg-white p-4 rounded-lg border border-gray-200 hover:border-[#1F7A4C] transition-colors text-center"
            >
              By Project
            </button>
            <button
              onClick={() => navigate('/harvests')}
              className="bg-white p-4 rounded-lg border border-gray-200 hover:border-[#1F7A4C] transition-colors text-center"
            >
              By Farm
            </button>
            <button className="bg-white p-4 rounded-lg border border-gray-200 hover:border-[#1F7A4C] transition-colors text-center">
              By Country
            </button>
            <button className="bg-white p-4 rounded-lg border border-gray-200 hover:border-[#1F7A4C] transition-colors text-center">
              By Grass
            </button>
          </div>
        </div>

        {/* Desktop Link */}
        <button
          onClick={() => navigate('/dashboard')}
          className="w-full mt-6 py-3 bg-gray-800 text-white rounded-lg flex items-center justify-center gap-2 hover:bg-gray-700 transition-colors"
        >
          <BarChart3 className="w-5 h-5" />
          View Desktop Dashboard
        </button>
      </div>

      {/* Desktop Redirect Message */}
      <div className="hidden lg:flex items-center justify-center min-h-screen p-8">
        <div className="text-center">
          <h1 className="text-3xl font-semibold mb-4 text-gray-900">STS Turf Operations</h1>
          <p className="text-gray-600 mb-6">For the best desktop experience, please visit the dashboard.</p>
          <button
            onClick={() => navigate('/dashboard')}
            className="px-6 py-3 bg-[#1F7A4C] text-white rounded-lg font-medium hover:bg-[#196A40] transition-colors inline-flex items-center gap-2"
          >
            <BarChart3 className="w-5 h-5" />
            Go to Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
