const path = require('path')
const url = require('url')
const http = require('http')
const querystring = require('querystring')
const fs = require('fs').promises
const { createReadStream, createWriteStream, readFileSync, writeFileSync } = require('fs')
const zlib = require('zlib')

const nunjucks = require('nunjucks')
const chalk = require('chalk')
const mime = require('mime')
const crypto = require('crypto')

Buffer.prototype.split = function(sep) {
    const arr = []
    const len = Buffer.from(sep).length
    let current;
    let offset = 0
    while((current = this.indexOf(sep, offset)) !== -1) {
        arr.push(this.slice(offset, current))
        offset = current + len
    }
    arr.push(this.slice(offset))
    return arr
}
class Server {
    constructor(options = {}) {
        this.port = options.port
        this.directory = options.directory
    }
    async handlerRequest(req, res) {
        let { pathname } = url.parse(req.url)
        pathname = decodeURIComponent(pathname) // 防止url中有中文

        const absPath = path.join(this.directory, pathname)
        if(pathname === '/img') { // 临时功能，图片上传
            const arr = []
            req.on('data', chunk => {
                arr.push(chunk)
            })
            req.on('end', () => {
                const body = Buffer.concat(arr)
                const boundary = `--${req.headers['content-type'].split('boundary=')[1]}`
                const data = body.split(boundary).slice(1, -1)[0]

                let [info, value] = data.split('\r\n\r\n')
                info = info.toString()
                if(info.includes('filename')) {
                    const filename = info.match(/filename\=\"(.+)\"/)[1]
                    const filePath = path.resolve(__dirname, `./assets/${filename}`)
                    const content = data.slice(info.length + 4, -2)
                    const writeStream = createWriteStream(filePath)
                    writeStream.write(content, error => {
                        console.log(error)
                    })
                }
                res.setHeader('Content-type', 'text/html;charset=utf-8')
                return res.end(`<html><body>${data}</body></html>`)
            })
            return
        }
        try{
            const statObj = await fs.stat(absPath)
            if(statObj.isDirectory()) {
                this.sendDirlist(pathname, absPath, res)
            }else {
                this.sendFile(statObj, absPath, req, res)
            }
        }catch(e) {
            if(req.headers.origin) {
                res.setHeader('Access-Control-Allow-Origin', req.headers.origin)
                res.setHeader('Access-Control-Allow-Credentials', 'true') //允许请求携带cookie
                res.setHeader('Access-Control-Allow-Headers', '*')
                res.setHeader('Access-Control-Max-Age', '1800') // 设置OPTIONS预检最大存活时间，单位s,一般三分钟
                res.setHeader('Access-Control-Allow-Methods', 'PUT,DELETE,OPTIONS') // 默认支持get，post
                res.setHeader('Set-Cookie', 'name=zhi;SameSite=None;Secure')
                if(req.method === 'OPTIONS') {
                    return res.end()
                }
            }
            this.statusCode = 404
            res.end('not found')
        }
        
    }
    async sendDirlist(pathname, absPath, res) {
        const dirs = await fs.readdir(absPath)
        const pathArr = dirs.map(dir => {
            return {text: dir, path: path.join(pathname, dir)}
        })
        const template = nunjucks.render(path.resolve(__dirname, '../public/template.html'), { dirs: pathArr })

        res.setHeader('Content-Type', 'text/html;charset=utf-8')
        res.end(template)
    }
    hasCache(statObj, absPath, req, res) {
        // 获取文件最后一次修改时间
        const ctime = statObj.ctime.toUTCString()
        // 强制缓存，Expires 设置绝对时间，Cache-Control 设置相对时间
        res.setHeader('Expires', new Date(Date.now() + 3600 * 24 * 1000).toUTCString())
        res.setHeader('Cache-Control', 'max-age=3600 * 24')
        // 对比缓存
        res.setHeader('Last-Modified', ctime)
        // 协商缓存
        const content = readFileSync(absPath, 'utf8')
        const hash = crypto.createHash('md5').update(content).digest('base64')
        res.setHeader('Etag', hash)
        // 如果第一次访问时服务端返回了Last-Modified头，那么再次请求时，请求头会带着is-modified-since，我们可以对比时间是否改变
        if(req.headers['is-modified-since'] !== ctime) {
            return false
        }
        // 如果第一次访问时服务端返回了Etag, 再次请求，请求头会带if-none-match
        if(req.headers['if-none-match'] !== hash) {
            return false
        }
        return true
    }
    sendFile(statObj, absPath, req, res) {
        res.setHeader('Content-Type', `${mime.getType(absPath)};charset=utf-8`)
        if(this.hasCache(statObj, absPath, req, res)) {
            res.statusCode = 304
            res.end()
        }
        // 处理206
        const range = req.headers['range']
        if(range) {
            let [, start, end] = range.match(/\b(\d+)-(\d+)\b/)
            start = Number(start)
            end = Number(end)
            res.statusCode = 206
            res.setHeader('Content-Range', `bytes ${start}-${end}/${statObj.size}`)
            return createReadStream(absPath, {start, end}).pipe(res)
        }
        // 处理压缩
        const encoding = req.headers['accept-encoding']
        if(encoding.match(/\bgzip\b/)) {
            res.setHeader('Content-Encoding', 'gzip')
            createReadStream(absPath).pipe(zlib.createGzip()).pipe(res)
        }else if(encoding.match(/\bdeflate\b/)){
            res.setHeader('Content-Encoding', 'deflate')
            createReadStream(absPath).pipe(zlib.createDeflate()).pipe(res)
        }else {
            createReadStream(absPath).pipe(res)
        }
    }
    start() {
        const server = http.createServer(this.handlerRequest.bind(this))
        server.listen(this.port, () => {
            console.log(`f-server serving...\nplease visit http://127.0.0.1:${chalk.green(this.port)}\nHit CTRL+c to stop the server`)
        })
        server.on('error', (err) => {
            if(err.errno === 'EADDRINUSE') { // 端口被占用
                this.port ++
                server.listen(this.port)
            }
        })
    }
}

module.exports = Server