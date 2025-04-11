import { ApiService } from './api';
import { ChartComponent } from './chart';
import { AuthService } from './auth';

/**
 * Application singleton to manage app lifecycle
 */
class TradingViewApp {
  constructor() {
    this.authService = null;
    this.apiService = null;
    this.chart = null;
    this.isInitialized = false;
  }

  /**
   * Show error message to the user
   * @param {string} title - Error title
   * @param {string} message - Error message
   */
  showError(title, message) {
    // Remove any existing error
    const existingError = document.getElementById('error-container');
    if (existingError) {
      document.body.removeChild(existingError);
    }
    
    const errorContainer = document.createElement('div');
    errorContainer.id = 'error-container';
    errorContainer.className = 'error-container';
    
    errorContainer.innerHTML = `
      <div class="error-content">
        <h3>${title}</h3>
        <p>${message}</p>
        <button id="error-close">Dismiss</button>
      </div>
    `;
    
    document.body.appendChild(errorContainer);
    
    document.getElementById('error-close').addEventListener('click', () => {
      document.body.removeChild(errorContainer);
    });
  }

  /**
   * Show loading indicator
   * @param {string} message - Loading message
   * @returns {HTMLElement} Loading indicator element
   */
  showLoading(message = 'Loading...') {
    this.hideLoading();
    
    const loadingIndicator = document.createElement('div');
    loadingIndicator.id = 'loading-indicator';
    loadingIndicator.className = 'loading-indicator';
    loadingIndicator.textContent = message;
    document.body.appendChild(loadingIndicator);
    
    return loadingIndicator;
  }
  
  /**
   * Hide loading indicator
   */
  hideLoading() {
    const existingIndicator = document.getElementById('loading-indicator');
    if (existingIndicator) {
      document.body.removeChild(existingIndicator);
    }
  }
  
  /**
   * Set the active interval button
   * @param {NodeList} buttons - Interval buttons
   * @param {string} interval - Active interval
   */
  setActiveIntervalButton(buttons, interval) {
    buttons.forEach(button => {
      if (button.getAttribute('data-interval') === interval) {
        button.classList.add('active');
      } else {
        button.classList.remove('active');
      }
    });
  }
  
  /**
   * Get the currently selected interval
   * @param {NodeList} buttons - Interval buttons
   * @returns {string} Current interval
   */
  getCurrentInterval(buttons) {
    const activeButton = Array.from(buttons).find(button => button.classList.contains('active'));
    return activeButton ? activeButton.getAttribute('data-interval') : '1d';
  }
  
  /**
   * Initialize the application services
   */
  initServices() {
    try {
      this.authService = new AuthService();
      this.authService.loadCredentials();
      
      const config = {
        apiBaseUrl: this.authService.credentials.apiBaseUrl,
        wsBaseUrl: this.authService.credentials.wsBaseUrl
      };
      
      this.apiService = new ApiService(this.authService, config);
      
      return true;
    } catch (error) {
      console.error('Failed to initialize services:', error);
      
      if (error.message.includes('Missing required configuration')) {
        this.showError('Environment Variables Missing', `
          <p>Required environment variables are missing or invalid.</p>
          <p>Please ensure you have a .env file with the following variables:</p>
          <pre style="background: #f5f5f5; padding: 10px; overflow: auto; text-align: left;">
CLIENT_ID=your_client_id_here
CLIENT_SECRET=your_client_secret_here
# Optional:
# TOKEN_URL=https://eightcap-embedded.auth.ap-northeast-1.amazoncognito.com/oauth2/token
# API_BASE_URL=https://api.embedded.eightcap.com
# WS_BASE_URL=wss://quote.embedded.eightcap.com
          </pre>
          <p>Check the README.md for instructions on setting environment variables.</p>
        `);
      } else {
        this.showError('Initialization Failed', 'Failed to initialize application services. ' + error.message);
      }
      
      return false;
    }
  }
  
  /**
   * Initialize the chart component
   */
  initChart() {
    try {
      const chartContainer = document.getElementById('chart-container');
      
      if (!chartContainer) {
        throw new Error('Chart container element not found');
      }
      
      this.chart = new ChartComponent(chartContainer, this.apiService);
      
      return true;
    } catch (error) {
      console.error('Failed to initialize chart:', error);
      this.showError('Chart Initialization Failed', 'Failed to initialize the chart component. ' + error.message);
      return false;
    }
  }
  
  /**
   * Set up event listeners for UI controls
   */
  setupEventListeners() {
    try {
      const symbolSelect = document.getElementById('symbol-select');
      const intervalButtons = document.querySelectorAll('.interval-selector button');
      
      if (!symbolSelect || !intervalButtons.length) {
        throw new Error('UI controls not found');
      }
      
      // Handle symbol changes
      symbolSelect.addEventListener('change', async (event) => {
        if (this.chart.isLoading) return;
        
        const newSymbol = event.target.value;
        const currentInterval = this.getCurrentInterval(intervalButtons);
        
        this.loadChart(newSymbol, currentInterval);
      });
      
      // Handle interval changes
      intervalButtons.forEach(button => {
        button.addEventListener('click', async () => {
          if (this.chart.isLoading) return;
          
          const interval = button.getAttribute('data-interval');
          
          this.setActiveIntervalButton(intervalButtons, interval);
          
          try {
            await this.chart.changeInterval(interval);
          } catch (error) {
            console.error(`Error changing interval to ${interval}:`, error);
            this.showError('Interval Change Failed', `Failed to change to ${interval}. ` + error.message);
          }
        });
      });
      
      // Listen for window beforeunload to clean up resources
      window.addEventListener('beforeunload', () => {
        this.cleanup();
      });
      
      return true;
    } catch (error) {
      console.error('Failed to set up event listeners:', error);
      this.showError('UI Setup Failed', 'Failed to set up UI controls. ' + error.message);
      return false;
    }
  }
  
  /**
   * Load chart with specified symbol and interval
   * @param {string} symbol - Instrument symbol
   * @param {string} interval - Candle interval
   */
  async loadChart(symbol, interval) {
    try {
      const loadingIndicator = this.showLoading(`Loading ${symbol}...`);
      
      await this.chart.loadSymbol(symbol, interval);
      
      const intervalButtons = document.querySelectorAll('.interval-selector button');
      this.setActiveIntervalButton(intervalButtons, interval);
      
      this.hideLoading();
    } catch (error) {
      console.error(`Error loading symbol ${symbol}:`, error);
      this.hideLoading();
      this.showError('Symbol Load Failed', `Failed to load ${symbol}. ` + error.message);
    }
  }
  
  /**
   * Initialize the demo application
   */
  async init() {
    if (this.isInitialized) return;
    
    try {
      const loadingIndicator = this.showLoading('Initializing...');
      
      const servicesInitialized = this.initServices();
      if (!servicesInitialized) {
        this.hideLoading();
        return;
      }
      
      const chartInitialized = this.initChart();
      if (!chartInitialized) {
        this.hideLoading();
        return;
      }
      
      const listenersSetup = this.setupEventListeners();
      if (!listenersSetup) {
        this.hideLoading();
        return;
      }
      
      // Load initial chart
      const symbolSelect = document.getElementById('symbol-select');
      const intervalButtons = document.querySelectorAll('.interval-selector button');
      
      // Initial symbol and interval
      const initialSymbol = symbolSelect.value;
      const initialInterval = '1d'; // Default to daily view
      
      try {
        await this.chart.loadSymbol(initialSymbol, initialInterval);
        
        this.setActiveIntervalButton(intervalButtons, initialInterval);
        
        this.isInitialized = true;
      } catch (error) {
        console.error('Failed to load initial chart:', error);
        this.showError('Chart Loading Failed', 'Unable to load initial chart data. ' + error.message);
      }
      
      this.hideLoading();
      
    } catch (error) {
      console.error('Failed to initialize application:', error);
      this.hideLoading();
      this.showError('Initialization Failed', 'Failed to initialize application. ' + error.message);
    }
  }
  
  /**
   * Clean up resources
   */
  cleanup() {
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
    
    if (this.apiService) {
      this.apiService.cleanup();
      this.apiService = null;
    }
    
    if (this.authService) {
      this.authService.cleanup();
      this.authService = null;
    }
    
    this.isInitialized = false;
  }
}

const app = new TradingViewApp();

// Start the application once the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  app.init();
});