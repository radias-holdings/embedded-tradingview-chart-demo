import { loadConfig } from './config';
import { AuthService } from './auth';
import { ApiService } from './api';
import { ChartComponent } from './chart';

/**
 * Main application class
 */
class TradingViewApp {
  constructor() {
    this.config = loadConfig();
    this.authService = null;
    this.apiService = null;
    this.chart = null;
    this.isInitialized = false;
  }

  /**
   * Show error message
   */
  showError(title, message) {
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
        <div class="error-buttons">
          <button id="error-close">Dismiss</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(errorContainer);
    
    document.getElementById('error-close').addEventListener('click', () => {
      document.body.removeChild(errorContainer);
    });
  }

  /**
   * Show loading indicator
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
   * Initialize services
   */
  initServices() {
    try {
      this.authService = new AuthService(this.config);
      this.apiService = new ApiService(this.authService, this.config);
      return true;
    } catch (error) {
      console.error('Failed to initialize services:', error);
      
      if (error.message.includes('Missing required configuration')) {
        this.showError('Configuration Missing', `
          <p>Required environment variables are missing.</p>
          <p>Please ensure you have a .env file with the following variables:</p>
          <pre style="background: #f5f5f5; padding: 10px; overflow: auto; text-align: left;">
CLIENT_ID=your_client_id_here
CLIENT_SECRET=your_client_secret_here
REFERER=your_referer_value_here</pre>
        `);
      } else {
        this.showError('Initialization Failed', `Failed to initialize services: ${error.message}`);
      }
      
      return false;
    }
  }
  
  /**
   * Initialize chart
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
      this.showError('Chart Initialization Failed', `Failed to initialize chart: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Set up UI event listeners
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
          
          // Update UI immediately
          this.setActiveIntervalButton(intervalButtons, interval);
          
          // Set button to loading state
          button.classList.add('loading');
          
          try {
            await this.chart.changeInterval(interval);
          } catch (error) {
            console.error(`Error changing interval:`, error);
            this.showError('Interval Change Failed', `Failed to change interval: ${error.message}`);
          } finally {
            // Remove loading state
            button.classList.remove('loading');
          }
        });
      });
      
      // Cleanup on page unload
      window.addEventListener('beforeunload', () => {
        this.cleanup();
      });
      
      return true;
    } catch (error) {
      console.error('Failed to set up event listeners:', error);
      this.showError('UI Setup Failed', `Failed to setup UI: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Set active interval button
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
   * Get current selected interval
   */
  getCurrentInterval(buttons) {
    const activeButton = Array.from(buttons).find(button => button.classList.contains('active'));
    return activeButton ? activeButton.getAttribute('data-interval') : '1d';
  }
  
  /**
   * Load chart with symbol and interval
   */
  async loadChart(symbol, interval) {
    try {
      this.showLoading(`Loading ${symbol}...`);
      
      await this.chart.loadSymbol(symbol, interval);
      
      this.hideLoading();
    } catch (error) {
      console.error(`Error loading symbol:`, error);
      this.hideLoading();
      this.showError('Chart Loading Failed', `Failed to load chart data: ${error.message}`);
    }
  }
  
  /**
   * Initialize the application
   */
  async init() {
    if (this.isInitialized) return;
    
    try {
      this.showLoading('Initializing...');
      
      // Initialize services
      if (!this.initServices()) {
        this.hideLoading();
        return;
      }
      
      // Initialize chart
      if (!this.initChart()) {
        this.hideLoading();
        return;
      }
      
      // Set up event listeners
      if (!this.setupEventListeners()) {
        this.hideLoading();
        return;
      }
      
      // Load initial chart
      const symbolSelect = document.getElementById('symbol-select');
      const intervalButtons = document.querySelectorAll('.interval-selector button');
      
      const initialSymbol = symbolSelect.value;
      const initialInterval = '1d'; // Default to daily
      
      try {
        await this.chart.loadSymbol(initialSymbol, initialInterval);
        this.setActiveIntervalButton(intervalButtons, initialInterval);
        this.isInitialized = true;
      } catch (error) {
        console.error('Failed to load initial chart:', error);
        this.showError('Chart Loading Failed', `Failed to load initial chart: ${error.message}`);
      }
      
      this.hideLoading();
      
    } catch (error) {
      console.error('Failed to initialize application:', error);
      this.hideLoading();
      this.showError('Initialization Failed', `Failed to initialize application: ${error.message}`);
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

// Initialize application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  const app = new TradingViewApp();
  app.init();
});