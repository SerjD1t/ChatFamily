//go:build legacy

package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"familychat/internal/chat"
	"familychat/internal/config"
	"golang.org/x/crypto/bcrypt"
)

type application struct { cfg config.Config; service *chat.Service; passwordHash []byte }
type credentials struct { Email string `json:"email"`; Password string `json:"password"` }

func main() {
	cfg, err := config.Load(); if err != nil { slog.Error("invalid configuration", "error", err); os.Exit(1) }
	hash, err := bcrypt.GenerateFromPassword([]byte(cfg.AdminPassword), bcrypt.DefaultCost); if err != nil { slog.Error("password setup failed", "error", err); os.Exit(1) }
	admin := chat.User{ID:"admin", Email:cfg.AdminEmail, Name:"Администратор", Permissions:map[chat.Permission]bool{chat.ManageUsers:true,chat.CreateGroups:true,chat.ManageGroupMembers:true,chat.ManageGroupSettings:true,chat.SendMessages:true,chat.EditOwnMessages:true,chat.DeleteOwnMessages:true}}
	a := &application{cfg:cfg, service:chat.New(admin), passwordHash:hash}
	mux:=http.NewServeMux(); mux.HandleFunc("GET /healthz",a.health); mux.HandleFunc("POST /api/v1/auth/login",a.login); mux.HandleFunc("POST /api/v1/auth/logout",a.logout); mux.HandleFunc("GET /api/v1/auth/me",a.auth(a.me)); mux.HandleFunc("GET /api/v1/conversations",a.auth(a.listConversations)); mux.HandleFunc("POST /api/v1/conversations",a.auth(a.createGroup)); mux.HandleFunc("GET /api/v1/conversations/{id}/messages",a.auth(a.messages)); mux.HandleFunc("POST /api/v1/conversations/{id}/messages",a.auth(a.createMessage)); mux.HandleFunc("PATCH /api/v1/messages/{id}",a.auth(a.editMessage)); mux.HandleFunc("DELETE /api/v1/messages/{id}",a.auth(a.deleteMessage))
	web:=http.FileServer(http.Dir("web")); mux.Handle("GET /",web)
	s:=&http.Server{Addr:cfg.Addr,Handler:securityHeaders(mux),ReadHeaderTimeout:5*time.Second,ReadTimeout:15*time.Second,WriteTimeout:30*time.Second,IdleTimeout:60*time.Second};slog.Info("server started", "address",cfg.Addr);if err:=s.ListenAndServe();err!=nil&&!errors.Is(err,http.ErrServerClosed){slog.Error("server stopped", "error",err);os.Exit(1)}
}

func securityHeaders(next http.Handler) http.Handler { return http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){w.Header().Set("X-Content-Type-Options","nosniff");w.Header().Set("X-Frame-Options","DENY");w.Header().Set("Referrer-Policy","same-origin");next.ServeHTTP(w,r)}) }
func (a *application) health(w http.ResponseWriter,r *http.Request){writeJSON(w,http.StatusOK,map[string]string{"status":"ok"})}
func (a *application) login(w http.ResponseWriter,r *http.Request){var c credentials;if err:=readJSON(r,&c);err!=nil{problem(w,http.StatusBadRequest,"Некорректные данные");return};if !strings.EqualFold(strings.TrimSpace(c.Email),a.cfg.AdminEmail)||bcrypt.CompareHashAndPassword(a.passwordHash,[]byte(c.Password))!=nil{problem(w,http.StatusUnauthorized,"Неверный адрес или пароль");return};token:=a.sign("admin",time.Now().Add(14*24*time.Hour));http.SetCookie(w,&http.Cookie{Name:"family_session",Value:token,Path:"/",HttpOnly:true,SameSite:http.SameSiteLaxMode,Secure:r.TLS!=nil,MaxAge:14*24*60*60});a.me(w,r.WithContext(withUser(r,"admin")))}
func (a *application) logout(w http.ResponseWriter,r *http.Request){http.SetCookie(w,&http.Cookie{Name:"family_session",Value:"",Path:"/",MaxAge:-1,HttpOnly:true,SameSite:http.SameSiteLaxMode});w.WriteHeader(http.StatusNoContent)}

type contextKey struct{}
func withUser(r *http.Request,id string)*http.Request{return r.WithContext(context.WithValue(r.Context(),contextKey{},id))}
func (a *application) auth(next http.HandlerFunc)http.HandlerFunc{return func(w http.ResponseWriter,r *http.Request){c,err:=r.Cookie("family_session");if err!=nil{problem(w,http.StatusUnauthorized,"Требуется вход");return};id,ok:=a.verify(c.Value);if !ok{problem(w,http.StatusUnauthorized,"Сессия истекла");return};next(w,withUser(r,id))}}
func userID(r *http.Request)string{return r.Context().Value(contextKey{}).(string)}
func (a *application) user(r *http.Request)(chat.User,bool){return a.service.User(userID(r))}
func (a *application) me(w http.ResponseWriter,r *http.Request){u,ok:=a.user(r);if !ok{problem(w,http.StatusUnauthorized,"Требуется вход");return};writeJSON(w,http.StatusOK,u)}
func (a *application) listConversations(w http.ResponseWriter,r *http.Request){writeJSON(w,http.StatusOK,a.service.Conversations(userID(r)))}
func (a *application) createGroup(w http.ResponseWriter,r *http.Request){u,_:=a.user(r);var x struct{Title string `json:"title"`; MemberIDs []string `json:"memberIds"`};if err:=readJSON(r,&x);err!=nil{problem(w,400,"Некорректные данные");return};c,err:=a.service.CreateGroup(u,x.Title,x.MemberIDs);if err!=nil{handleDomain(w,err);return};writeJSON(w,http.StatusCreated,c)}
func (a *application) messages(w http.ResponseWriter,r *http.Request){u,_:=a.user(r);out,err:=a.service.Messages(u,r.PathValue("id"));if err!=nil{handleDomain(w,err);return};writeJSON(w,http.StatusOK,out)}
func (a *application) createMessage(w http.ResponseWriter,r *http.Request){u,_:=a.user(r);var x struct{Body string `json:"body"`; Attachments []chat.Attachment `json:"attachments"`};if err:=readJSON(r,&x);err!=nil{problem(w,400,"Некорректные данные");return};m,err:=a.service.CreateMessage(u,r.PathValue("id"),x.Body,x.Attachments);if err!=nil{handleDomain(w,err);return};writeJSON(w,http.StatusCreated,m)}
func (a *application) editMessage(w http.ResponseWriter,r *http.Request){u,_:=a.user(r);var x struct{Body string `json:"body"`};if err:=readJSON(r,&x);err!=nil{problem(w,400,"Некорректные данные");return};m,err:=a.service.EditMessage(u,r.PathValue("id"),x.Body);if err!=nil{handleDomain(w,err);return};writeJSON(w,http.StatusOK,m)}
func (a *application) deleteMessage(w http.ResponseWriter,r *http.Request){u,_:=a.user(r);m,err:=a.service.DeleteMessage(u,r.PathValue("id"));if err!=nil{handleDomain(w,err);return};writeJSON(w,http.StatusOK,m)}
func handleDomain(w http.ResponseWriter,err error){switch err{case chat.ErrForbidden:problem(w,403,"Недостаточно прав");case chat.ErrNotFound:problem(w,404,"Не найдено");default:problem(w,400,"Некорректные данные")}}
func readJSON(r *http.Request,v any)error{r.Body=http.MaxBytesReader(nil,r.Body,1<<20);defer r.Body.Close();return json.NewDecoder(r.Body).Decode(v)}
func writeJSON(w http.ResponseWriter,status int,v any){w.Header().Set("Content-Type","application/json; charset=utf-8");w.WriteHeader(status);_ = json.NewEncoder(w).Encode(v)}
func problem(w http.ResponseWriter,status int,message string){writeJSON(w,status,map[string]string{"error":message})}
func (a *application) sign(id string,expiry time.Time)string{payload:=base64.RawURLEncoding.EncodeToString([]byte(id+"."+expiry.UTC().Format(time.RFC3339)));m:=hmac.New(sha256.New,[]byte(a.cfg.SessionSecret));m.Write([]byte(payload));return payload+"."+base64.RawURLEncoding.EncodeToString(m.Sum(nil))}
func (a *application) verify(token string)(string,bool){parts:=strings.Split(token,".");if len(parts)!=2{return "",false};m:=hmac.New(sha256.New,[]byte(a.cfg.SessionSecret));m.Write([]byte(parts[0]));sig,err:=base64.RawURLEncoding.DecodeString(parts[1]);if err!=nil||!hmac.Equal(sig,m.Sum(nil)){return "",false};raw,err:=base64.RawURLEncoding.DecodeString(parts[0]);if err!=nil{return "",false};p:=strings.Split(string(raw),".");if len(p)!=2{return "",false};until,err:=time.Parse(time.RFC3339,p[1]);return p[0],err==nil&&time.Now().Before(until)}
var _ fs.FS
