// File: frontend/src/App.jsx
import React, { useState, useEffect, useCallback } from 'react';

const API_BASE_URL = 'http://localhost:5001/api';

// --- Main App Component ---
export default function App() {
  const [communications, setCommunications] = useState([]);
  const [isLoadingComms, setIsLoadingComms] = useState(false);
  const [view, setView] = useState('dashboard'); // 'dashboard' or 'campaign'
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [error, setError] = useState(null);
  const [lookupUserId, setLookupUserId] = useState('1001'); // The value in the input box
  const [searchedUserId, setSearchedUserId] = useState('1001'); // The ID that has been searched for

  // Fetch communications when a searched user or date changes
  const fetchCommunications = useCallback((userId, date) => {
    if (!userId) return;
    setIsLoadingComms(true);
    setError(null);

    const startOfDay = new Date(date);
    startOfDay.setUTCHours(0,0,0,0);
    const query = { "user.id": parseInt(userId), day: startOfDay };
    console.log("Executing Req B & E: db.collection('communications').findOne(", JSON.stringify(query, null, 2), ")");

    fetch(`${API_BASE_URL}/communications/user/${userId}?date=${date}`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return res.json();
      })
      .then(data => {
        setCommunications(data);
        setIsLoadingComms(false);
      })
      .catch(error => {
        console.error("Fetch communications error:", error);
        setError("Failed to fetch communications. Please check the server connection or user ID.");
        setIsLoadingComms(false);
      });
  }, []);

  useEffect(() => {
    if (searchedUserId) {
        fetchCommunications(searchedUserId, selectedDate);
    }
  }, [searchedUserId, selectedDate, fetchCommunications]);


  const handleDateChange = (e) => {
    const newDate = e.target.value;
    setSelectedDate(newDate);
  }

  const handleSearch = () => {
    setSearchedUserId(lookupUserId);
  }

  const handleUpdateStatus = (comm, newStatus) => {
    setError(null);
    const payload = {
      userId: parseInt(searchedUserId),
      dispatch_time: comm.dispatch_time,
      templateId: comm.metadata.template_id,
      trackingId: comm.metadata.tracking_id,
      newStatus: newStatus
    };

    fetch(`${API_BASE_URL}/communications/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    .then(res => {
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return res.json();
    })
    .then(() => fetchCommunications(searchedUserId, selectedDate)) // Refresh data
    .catch(err => {
        console.error("Update status error:", err);
        setError("Failed to update status. Please try again.");
    });
  };

  const handleSendNewComm = (count) => {
    if (!searchedUserId || count < 1) return;
    setError(null);
    const templateId = `template_${String(Math.floor(Math.random() * 20) + 1).padStart(3, '0')}`;
    const trackingId = `track_${String(Math.floor(Math.random() * 10) + 1).padStart(3, '0')}`;
    const userType = Math.random() > 0.5 ? 'premium' : 'standard'; // Assume we get this from somewhere

    fetch(`${API_BASE_URL}/communications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: parseInt(searchedUserId), userType, templateId, trackingId, count: parseInt(count) })
    })
    .then(async res => {
        if (!res.ok) {
            const errData = await res.json();
            throw new Error(errData.message || `HTTP error! status: ${res.status}`);
        }
        return res.json();
    })
    .then(() => {
        const today = new Date().toISOString().split('T')[0];
        if (selectedDate === today) {
            fetchCommunications(searchedUserId, selectedDate);
        } else {
            alert(`${count} new communication(s) sent for today.`);
        }
    })
    .catch(err => {
        console.error("Send new comm error:", err);
        setError(err.message);
    });
  };

  const handleReplaceComms = () => {
    if (!searchedUserId) return;
    setError(null);

    const mockNewComms = [
        {
            dispatch_time: new Date(),
            metadata: { tracking_id: "REPLACED-01", template_id: "REPLACE-TPL" },
            content_score: 1.0,
            status: "replaced"
        },
        {
            dispatch_time: new Date(),
            metadata: { tracking_id: "REPLACED-02", template_id: "REPLACE-TPL" },
            content_score: 1.0,
            status: "replaced"
        }
    ];

    fetch(`${API_BASE_URL}/communications/replace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            userId: parseInt(searchedUserId),
            date: selectedDate,
            communications: mockNewComms
        })
    })
    .then(res => {
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return res.json();
    })
    .then(() => {
        alert(`Communications for ${selectedDate} have been replaced.`);
        fetchCommunications(searchedUserId, selectedDate); // Refresh data
    })
    .catch(err => {
        console.error("Replace comms error:", err);
        setError("Failed to replace communications. Please try again.");
    });
  };

  return (
    <div className="bg-gray-50 min-h-screen font-sans">
      <Header setView={setView} currentView={view} />
      <main className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
        {error && <ErrorMessage message={error} />}
        {view === 'dashboard' ? (
          <Dashboard
            communications={communications}
            isLoadingComms={isLoadingComms}
            onUpdateStatus={handleUpdateStatus}
            onSendNewComm={handleSendNewComm}
            onReplaceComms={handleReplaceComms}
            selectedDate={selectedDate}
            onDateChange={handleDateChange}
            lookupUserId={lookupUserId}
            setLookupUserId={setLookupUserId}
            onSearch={handleSearch}
          />
        ) : (
          <CampaignView />
        )}
      </main>
    </div>
  );
}

// --- UI Components ---

function Tooltip({ text }) {
    return (
        <div className="relative flex items-center group">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
            </svg>
            <div className="absolute bottom-full mb-2 w-64 bg-gray-900 text-white text-xs rounded py-2 px-3 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-10">
                {text}
            </div>
        </div>
    );
}

function ErrorMessage({ message }) {
    return (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg relative mb-6" role="alert">
            <strong className="font-bold">Error: </strong>
            <span className="block sm:inline">{message}</span>
        </div>
    );
}

function Header({ setView, currentView }) {
  return (
    <header className="bg-white shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
          <h1 className="text-2xl font-bold text-gray-800">Internal Comms Capping Tool</h1>
        </div>
        <nav className="flex space-x-2 bg-gray-200 p-1 rounded-lg">
          <button onClick={() => setView('dashboard')} className={`px-4 py-1.5 text-sm font-medium rounded-md ${currentView === 'dashboard' ? 'bg-white text-gray-700 shadow' : 'text-gray-600 hover:bg-gray-300'}`}>User Lookup</button>
          <button onClick={() => setView('campaign')} className={`px-4 py-1.5 text-sm font-medium rounded-md ${currentView === 'campaign' ? 'bg-white text-gray-700 shadow' : 'text-gray-600 hover:bg-gray-300'}`}>Campaign Tool</button>
        </nav>
      </div>
    </header>
  );
}

function Dashboard({ communications, isLoadingComms, onUpdateStatus, onSendNewComm, onReplaceComms, selectedDate, onDateChange, lookupUserId, setLookupUserId, onSearch }) {
  return (
    <div>
      <UserLookup
        lookupUserId={lookupUserId}
        setLookupUserId={setLookupUserId}
        onSendNewComm={onSendNewComm}
        onSearch={onSearch}
      />
      <CommunicationsLog
          communications={communications}
          isLoading={isLoadingComms}
          onUpdateStatus={onUpdateStatus}
          onReplaceComms={onReplaceComms}
          selectedDate={selectedDate}
          onDateChange={onDateChange}
      />
    </div>
  );
}

function UserLookup({ lookupUserId, setLookupUserId, onSendNewComm, onSearch }) {
    const [count, setCount] = useState(1);

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            onSearch();
        }
    }

    return (
        <div className="bg-white p-6 rounded-lg shadow mb-6">
        <div className="flex justify-between items-center">
            <div className="flex items-center gap-4">
                <label htmlFor="userIdInput" className="text-lg font-semibold text-gray-700">User ID Lookup (Req B & E):</label>
                <input
                    id="userIdInput"
                    type="number"
                    value={lookupUserId}
                    onChange={(e) => setLookupUserId(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="p-2 border border-gray-300 rounded-md shadow-sm w-48"
                />
                <button onClick={onSearch} className="bg-gray-800 text-white px-4 py-2 rounded-lg font-semibold hover:bg-gray-900 transition-colors shadow">
                    Search
                </button>
            </div>
            <div className="flex items-center gap-2">
                <input
                    type="number"
                    value={count}
                    onChange={(e) => setCount(e.target.value)}
                    className="p-2 border border-gray-300 rounded-md shadow-sm w-20 text-center"
                    min="1"
                />
                <button onClick={() => onSendNewComm(count)} className="bg-green-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-green-700 transition-colors shadow">
                    Append Comm(s) (Req A)
                </button>
                <Tooltip text="Appends the specified number of new, random communications for the current user for today." />
            </div>
        </div>
        </div>
    );
}

function CommunicationsLog({ communications, isLoading, onUpdateStatus, onReplaceComms, selectedDate, onDateChange }) {
  return (
    <div className="bg-white p-4 rounded-lg shadow">
      <div className="flex justify-between items-center mb-4 border-b pb-2">
        <h3 className="text-lg font-semibold text-gray-700">Communications Log</h3>
        <div className="flex items-center gap-4">
          <input type="date" value={selectedDate} onChange={onDateChange} className="p-1 border border-gray-300 rounded-md shadow-sm"/>
          <div className="flex items-center gap-2">
            <button onClick={onReplaceComms} className="bg-amber-500 text-white px-3 py-1.5 rounded-lg text-sm font-semibold hover:bg-amber-600 transition-colors shadow">
                Replace Today's Comms (Req C)
            </button>
            <Tooltip text="Replaces all communications for the selected date with two mock 'REPLACED' events." />
          </div>
        </div>
      </div>
      <div className="space-y-3">
        {isLoading ? <p className="text-gray-500 text-center p-4">Loading...</p> :
          communications.length === 0 ? <p className="text-gray-500 text-center p-4">No communications found for this date.</p> :
            communications.map(comm => (
              <div key={comm.dispatch_time + comm.metadata.template_id} className="bg-gray-50 p-4 rounded-lg flex justify-between items-center">
                <div>
                  <p className="font-semibold text-gray-800">Template: {comm.metadata.template_id}</p>
                  <p className="text-sm text-gray-500">At: {new Date(comm.dispatch_time).toLocaleTimeString()} | Tracking ID: {comm.metadata.tracking_id}</p>
                </div>
                <div className="flex items-center space-x-2">
                    <span className={`px-2 py-1 text-xs font-bold rounded-full ${comm.status === 'sent' ? 'bg-blue-100 text-blue-800' : comm.status === 'opened' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>{comm.status}</span>
                    {comm.status === 'sent' && (
                        <button onClick={() => onUpdateStatus(comm, 'opened')} className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-700 font-semibold py-1 px-2 rounded-md">Mark as Opened (Req F)</button>
                    )}
                </div>
              </div>
            ))
        }
      </div>
    </div>
  );
}

function CampaignView() {
    const [params, setParams] = useState({
        date: new Date().toISOString().split('T')[0],
        hour: new Date().getHours(),
        templateId: '',
        trackingId: ''
    });
    const [templates, setTemplates] = useState([]);
    const [trackingIds, setTrackingIds] = useState([]); // New state for tracking IDs
    const [distinctUsers, setDistinctUsers] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        setError(null);
        // Fetch templates
        fetch(`${API_BASE_URL}/templates`)
            .then(res => {
                if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
                return res.json();
            })
            .then(data => {
                setTemplates(data);
                if(data.length > 0) {
                    setParams(p => ({...p, templateId: data[0]}));
                }
            })
            .catch(err => {
                console.error("Fetch templates error:", err);
                setError("Failed to load campaign templates.");
            });

        // Fetch tracking IDs
        fetch(`${API_BASE_URL}/tracking-ids`)
            .then(res => {
                if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
                return res.json();
            })
            .then(data => {
                setTrackingIds(data);
                if(data.length > 0) {
                    setParams(p => ({...p, trackingId: data[0]}));
                }
            })
            .catch(err => {
                console.error("Fetch tracking IDs error:", err);
                setError("Failed to load tracking IDs.");
            });
    }, []);

    const handleSearch = (e) => {
        e.preventDefault();
        setIsLoading(true);
        setDistinctUsers(null);
        setError(null);

        const startOfHour = new Date(params.date);
        startOfHour.setUTCHours(parseInt(params.hour), 0, 0, 0);
        const endOfHour = new Date(startOfHour.getTime() + 60 * 60 * 1000);

        const query = {
            day: new Date(params.date + 'T00:00:00.000Z'),
            events: {
                $elemMatch: {
                    "dispatch_time": { $gte: startOfHour, $lt: endOfHour },
                    "metadata.template_id": params.templateId,
                    "metadata.tracking_id": params.trackingId
                }
            }
        };
        console.log("Running Query for Req D: db.collection('communications').distinct('user.id',", JSON.stringify(query, null, 2), ")");

        const queryString = new URLSearchParams(params).toString();
        fetch(`${API_BASE_URL}/campaigns/distinct-users?${queryString}`)
            .then(res => {
                if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
                return res.json();
            })
            .then(data => {
                setDistinctUsers(data);
                setIsLoading(false);
            })
            .catch(err => {
                console.error("Campaign search error:", err);
                setError("Failed to search for campaign users.");
                setIsLoading(false);
            });
    }

    const handleChange = (e) => {
        setParams({...params, [e.target.name]: e.target.value});
    }

    return (
        <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-xl font-bold text-gray-800 mb-4">Find Distinct Users for Campaign (Req D)</h2>
            {error && <ErrorMessage message={error} />}
            <form onSubmit={handleSearch} className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end mb-6">
                <div>
                    <label className="block text-sm font-medium text-gray-600">Date</label>
                    <input type="date" name="date" value={params.date} onChange={handleChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500"/>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-600">Hour (0-23)</label>
                    <input type="number" name="hour" min="0" max="23" value={params.hour} onChange={handleChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500"/>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-600">Template ID</label>
                    <select name="templateId" value={params.templateId} onChange={handleChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500">
                        {templates.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-600">Tracking ID</label>
                    <select name="trackingId" value={params.trackingId} onChange={handleChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500">
                        {trackingIds.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                </div>
                <button type="submit" className="bg-green-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-green-700 transition-colors shadow h-10">Search</button>
            </form>
            <div>
                {isLoading && <p>Loading results...</p>}
                {distinctUsers && (
                    <div>
                        <h3 className="font-semibold text-lg">Found {distinctUsers.length} unique users:</h3>
                        <div className="mt-2 bg-gray-100 p-4 rounded-md max-h-60 overflow-y-auto">
                            {distinctUsers.length > 0 ? distinctUsers.join(', ') : 'No users found for this criteria.'}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
