const path = require('path')
const url = require('url')
const http = require('http')
const querystring = require('querystring')
const fs = require('fs').promises
const { createReadStream, createWriteStream, readFileSync } = require('fs')

const nunjucks = require('nunjucks')
const chalk = require('chalk')
const mime = require('mime')
const crypto = require('crypto')

class Server {
    constructor(options = {}) {
        this.port = options.port
        this.dir = options.dir
    }
    async handlerRequest(req, res) {
        let { pathname } = url.parse(req.url)
        pathname = decodeURIComponent(pathname) // 防止中文

        const absPath = path.join(__dirname, pathname)
        try{
            const statObj = await fs.stat(absPath)
            if(statObj.isDirectory()) {
                this.sendDirlist(pathname, absPath, res)
            }else {
                this.sendFile(statObj, absPath, req, res)
            }
        }catch(e) {
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
        // 强制缓存
        res.setHeader('Expires', new Date(Date.now() + 3600 * 24 * 1000).toUTCString())
        res.setHeader('Cache-Control', 'max-age=3600 * 24')
        // 对比缓存
        res.setHeader('Last-Modified', ctime)
        // 协商缓存
        const content = readFileSync(absPath, 'utf8')
        const hash = crypto.createHash('md5').update(content).digest('base64')
        res.setHeader('Etag', hash)

        if(req.headers['is-modified-since'] !== ctime) {
            return false
        }
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
        createReadStream(absPath).pipe(res)
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
