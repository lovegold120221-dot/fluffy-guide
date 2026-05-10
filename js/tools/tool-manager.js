import { Logger } from '../utils/logger.js';
import { ApplicationError, ErrorCodes } from '../utils/error-boundary.js';
import { GoogleSearchTool } from './google-search.js';
import { WeatherTool } from './weather-tool.js';
import { GmailTool } from './gmail-tool.js';
import { CalendarTool } from './calendar-tool.js';
import { DriveTool } from './drive-tool.js';
import { SheetsTool } from './sheets-tool.js';
import { SlidesTool } from './slides-tool.js';
import { TasksTool } from './tasks-tool.js';
import { GeolocationTool } from './geolocation-tool.js';

/**
 * Manages the registration and execution of tools.
 * Tools are used to extend the functionality of the Gemini API, allowing it to interact with external services.
 */
export class ToolManager {
    /**
     * Creates a new ToolManager and registers default tools.
     */
    constructor() {
        this.tools = new Map();
        this.registerDefaultTools();
    }

    /**
     * Registers the default tools: GoogleSearchTool, WeatherTool, and Google API tools.
     */
    registerDefaultTools() {
        this.registerTool('googleSearch', new GoogleSearchTool());
        this.registerTool('weather', new WeatherTool());
        
        // Register Google API tools
        this.registerTool('gmail', new GmailTool());
        this.registerTool('calendar', new CalendarTool());
        this.registerTool('drive', new DriveTool());
        this.registerTool('sheets', new SheetsTool());
        this.registerTool('slides', new SlidesTool());
        this.registerTool('tasks', new TasksTool());
        this.registerTool('geolocation', new GeolocationTool());
    }

    /**
     * Sets the OAuth access token for all Google API tools.
     * @param {string} token - The OAuth access token from Firebase Google Auth.
     */
    setGoogleAccessToken(token) {
        const googleTools = ['gmail', 'calendar', 'drive', 'sheets', 'slides', 'tasks'];
        // Note: geolocation tool doesn't need OAuth token as it uses browser API
        googleTools.forEach(toolName => {
            const tool = this.tools.get(toolName);
            if (tool && tool.setAccessToken) {
                tool.setAccessToken(token);
                Logger.info(`Access token set for ${toolName}`);
            }
        });
    }

    /**
     * Registers a new tool.
     *
     * @param {string} name - The name of the tool.
     * @param {Object} toolInstance - The tool instance. Must have a `getDeclaration` method.
     * @throws {ApplicationError} Throws an error if a tool with the same name is already registered.
     */
    registerTool(name, toolInstance) {
        if (this.tools.has(name)) {
            throw new ApplicationError(
                `Tool ${name} is already registered`,
                ErrorCodes.INVALID_STATE
            );
        }
        this.tools.set(name, toolInstance);
        Logger.info(`Tool ${name} registered successfully`);
    }

    /**
     * Returns the tool declarations for all registered tools.
     * These declarations are used by the Gemini API to understand what tools are available.
     *
     * @returns {Object[]} An array of tool declarations.
     */
    getToolDeclarations() {
        const allDeclarations = [];
        
        this.tools.forEach((tool, name) => {
            if (tool.getDeclaration) {
                if (name === 'weather') {
                    allDeclarations.push({
                        functionDeclarations: tool.getDeclaration()
                    });
                } else {
                    allDeclarations.push({ [name]: tool.getDeclaration() });
                }
            }
        });

        return allDeclarations;
    }

    /**
     * Handles a tool call from the Gemini API.
     * Executes the specified tool with the given arguments.
     *
     * @param {Object} functionCall - The function call object from the Gemini API.
     * @param {string} functionCall.name - The name of the tool to execute.
     * @param {Object} functionCall.args - The arguments to pass to the tool.
     * @param {string} functionCall.id - The ID of the function call.
     * @returns {Promise<Object>} A promise that resolves with the tool's response.
     * @throws {ApplicationError} Throws an error if the tool is unknown or if the tool execution fails.
     */
    async handleToolCall(functionCall) {
        const { name, args, id } = functionCall;
        Logger.info(`Handling tool call: ${name}`, { args });

        let tool;
        if (name === 'get_weather_on_date') {
            tool = this.tools.get('weather');
        } else {
            tool = this.tools.get(name);
        }

        if (!tool) {
            throw new ApplicationError(
                `Unknown tool: ${name}`,
                ErrorCodes.INVALID_PARAMETER
            );
        }

        try {
            const result = await tool.execute(args);
            return {
                functionResponses: [{
                    response: { output: result },
                    id
                }]
            };
        } catch (error) {
            Logger.error(`Tool execution failed: ${name}`, error);
            return {
                functionResponses: [{
                    response: { error: error.message },
                    id
                }]
            };
        }
    }
} 