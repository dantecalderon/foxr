/* eslint-disable no-use-before-define */
import EventEmitter from 'events'
import { writeFile } from 'fs'
import { promisify } from 'util'
import { TJsonValue } from 'typeon'

import Browser from './Browser'
import { TSend } from '../protocol'
import Element, { TElementId } from './Element'

const pWriteFile = promisify(writeFile)

type TStringifiableFunction = (...args: TJsonValue[]) => TJsonValue | Promise<TJsonValue> | void

class Page extends EventEmitter {
  private _browser: Browser
  private _id: number
  private _send: TSend

  constructor (arg: { browser: Browser, id: number, send: TSend }) {
    super()

    this._browser = arg.browser
    this._id = arg.id
    this._send = arg.send
  }

  async $ (selector: string) {
    try {
      type TResult = {
        value: TElementId
      }

      const { value } = await this._send('WebDriver:FindElement', {
        value: selector,
        using: 'css selector'
      }) as TResult

      return new Element({
        id: value,
        send: this._send
      })
    } catch (err) {
      if (err.message.startsWith('Unable to locate element')) {
        return null
      }

      throw err
    }
  }

  async $$ (selector: string) {
    const values = await this._send('WebDriver:FindElements', {
      value: selector,
      using: 'css selector'
    }) as TElementId[]

    return values.map((value) => new Element({
      id: value,
      send: this._send
    }))
  }

  async bringToFront () {
    return this._send('WebDriver:SwitchToWindow', {
      name: this._id,
      focus: true
    })
  }

  browser () {
    return this._browser
  }

  async close () {
    await this._send('WebDriver:ExecuteScript', {
      script: 'window.close()'
    })
  }

  async content (): Promise<string> {
    type TResult = {
      value: string
    }

    const { value } = await this._send('WebDriver:GetPageSource') as TResult

    return value
  }

  async evaluate (target: TStringifiableFunction | string, ...args: TJsonValue[]): Promise<TJsonValue | void> {
    type TResult = {
      value: {
        error: string | null,
        value: TJsonValue
      }
    }

    if (typeof target === 'function') {
      const { value: result } = await this._send('WebDriver:ExecuteAsyncScript', {
        script: `
          const args = Array.prototype.slice.call(arguments, 0, arguments.length - 1)
          const resolve = arguments[arguments.length - 1]

          Promise.resolve()
            .then(() => (${target.toString()})(...args))
            .then((value) => resolve({ error: null, value }))
            .catch((error) => resolve({ error: error instanceof Error ? error.message : error }))
        `,
        args
      }) as TResult

      if (result.error !== null) {
        throw new Error(`Evaluation failed: ${result.error}`)
      }

      return result.value
    }

    const { value: result } = await this._send('WebDriver:ExecuteAsyncScript', {
      script: `
        const resolve = arguments[0]

        Promise.resolve()
          .then(() => ${target})
          .then((value) => resolve({ error: null, value }))
          .catch((error) => resolve({ error: error instanceof Error ? error.message : error }))
      `
    }) as TResult

    if (result.error !== null) {
      throw new Error(`Evaluation failed: ${result.error}`)
    }

    return result.value
  }

  async focus (selector: string) {
    /* istanbul ignore next */
    return this.evaluate((sel) => {
      const el = document.querySelector(sel as string)

      if (el === null) {
        throw new Error('Unable to find element')
      }

      if (!(el instanceof HTMLElement)) {
        throw new Error('Found element is not HTMLElement and not focusable')
      }

      el.focus()
    }, selector)
  }

  async goto (url: string) {
    await this._send('WebDriver:Navigate', { url })
  }

  async screenshot (options: { path?: string } = {}): Promise<Buffer> {
    type TResult = {
      value: string
    }

    const result = await this._send('WebDriver:TakeScreenshot', {
      full: true,
      hash: false
    }) as TResult
    const buffer = Buffer.from(result.value, 'base64')

    if (typeof options.path === 'string') {
      await pWriteFile(options.path, buffer)
    }

    return buffer
  }

  async setContent (html: string) {
    return this._send('WebDriver:ExecuteScript', {
      script: 'document.documentElement.innerHTML = arguments[0]',
      args: [html]
    })
  }

  async setViewport ({ width, height }: { width: number, height: number }) {
    type TResult = {
      widthDelta: number,
      heightDelta: number
    }

    const { widthDelta, heightDelta } = await this.evaluate(`
      ({
        widthDelta: window.outerWidth - window.innerWidth,
        heightDelta: window.outerHeight - window.innerHeight
      })
    `) as TResult

    await this._send('WebDriver:SetWindowRect', {
      width: width + widthDelta,
      height: height + heightDelta
    })
  }

  async title (): Promise<string> {
    type TResult = {
      value: string
    }

    const result = await this._send('WebDriver:GetTitle') as TResult

    return result.value
  }

  async url (): Promise<string> {
    type TResult = {
      value: string
    }

    const result = await this._send('WebDriver:GetCurrentURL') as TResult

    return result.value
  }

  async viewport (): Promise<{ width: number, height: number }> {
    type TResult = {
      width: number,
      height: number
    }

    return await this.evaluate(`
      ({
        width: window.innerWidth,
        height: window.innerHeight
      })
    `) as TResult
  }
}

export default Page
